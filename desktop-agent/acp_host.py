"""Coding agents as chat sessions, over the Agent Client Protocol (ACP).

Each agent (Claude Code, Codex, Gemini CLI) runs headless as an ACP adapter: newline-delimited
JSON-RPC 2.0 on stdio. One adapter process per agent type holds all of its sessions. The phone
drives them with CHAT_* messages and gets back structured updates (text, tool calls, diffs,
permission requests) to draw as a chat, the way the agents' own mobile apps do.

Runs on the agent's asyncio loop. Nothing here blocks: a permission request waits as a pending
entry until the phone answers, however long that takes.
"""
import asyncio
import json
import os
import shutil
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ACP_MODULES = os.path.join(HERE, "acp", "node_modules", "@agentclientprotocol")
NPM_GLOBAL = os.path.join(os.environ.get("APPDATA", ""), "npm", "node_modules")
INDEX_FILE = os.path.join(os.path.expanduser("~"), ".termpilot", "sessions.json")
PC_SESSION_FILE = os.path.join(os.path.expanduser("~"), ".termpilot", "pc-session.json")
# Agents `tp` can run in the PC terminal and hand to the phone: they take a session id from the
# caller (--session-id) and resume it by id. Codex picks its own ids, so it is not here yet.
HANDOFF_AGENTS = {"claude"}

# Agent ids the phone may name. Entry scripts run through node directly: npm's .cmd shims go
# through cmd.exe, which mangles arguments and breaks when PATH lacks System32.
AGENTS = {
    "claude": {"name": "Claude Code", "entry": os.path.join(ACP_MODULES, "claude-agent-acp", "dist", "index.js"), "args": []},
    "codex": {"name": "Codex", "entry": os.path.join(ACP_MODULES, "codex-acp", "dist", "index.js"), "args": []},
    "gemini": {"name": "Gemini CLI", "entry": os.path.join(NPM_GLOBAL, "@google", "gemini-cli", "bundle", "gemini.js"), "args": ["--acp"]},
}
# Modes that approve every tool without asking. A phone that lost its key must not be one tap
# away from them, so they are never offered.
UNSAFE_MODES = {"bypassPermissions", "yolo", "full-access"}

MAX_TEXT = 32_000          # prompt length from the phone
MAX_LOG = 20_000           # events kept per session for phone sync
SYNC_PAGE_BYTES = 512_000  # CHAT_SYNC message size
FLUSH_SECONDS = 0.05       # text chunks are merged for this long before going to the phone


class ChatError(Exception):
    """A request the phone made that cannot be done; the message is shown to the user."""


def installed_agents() -> dict:
    return {aid: a["name"] for aid, a in AGENTS.items() if os.path.exists(a["entry"])}


def allowed_dir(path) -> str:
    """The real folder for a path from the phone, only if it is inside the home folder."""
    if not isinstance(path, str) or not path or len(path) > 1000 or path.startswith(("\\\\", "//")):
        raise ChatError("Not a folder on this PC")
    home = os.path.realpath(os.path.expanduser("~"))
    real = os.path.realpath(os.path.expanduser(path))
    if os.path.normcase(os.path.commonpath([home, real])) != os.path.normcase(home) or not os.path.isdir(real):
        raise ChatError("Pick a folder inside your user folder")
    return real


class Adapter:
    """One running ACP agent process and the JSON-RPC traffic with it."""

    def __init__(self, host, agent_id, proc):
        self.host, self.agent_id, self.proc = host, agent_id, proc
        self.next_id = 0
        self.waiting = {}
        self.capabilities = {}

    async def call(self, method, params):
        self.next_id += 1
        future = asyncio.get_running_loop().create_future()
        self.waiting[self.next_id] = future
        await self.write({"jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params})
        reply = await future
        if "error" in reply:
            raise ChatError(str(reply["error"].get("message", "Agent error"))[:500])
        return reply.get("result") or {}

    async def notify(self, method, params):
        await self.write({"jsonrpc": "2.0", "method": method, "params": params})

    async def write(self, message):
        if self.proc.returncode is not None:
            raise ChatError("The agent has stopped")
        self.proc.stdin.write((json.dumps(message) + "\n").encode())
        await self.proc.stdin.drain()

    async def read(self):
        async for line in self.proc.stdout:
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            method = msg.get("method")
            if method is None:
                future = self.waiting.pop(msg.get("id"), None)
                if future and not future.done():
                    future.set_result(msg)
            elif method == "session/update":
                self.host.on_update(msg["params"].get("sessionId"), msg["params"].get("update") or {})
            elif method == "session/request_permission":
                self.host.on_permission(self, msg.get("id"), msg["params"])
            elif "id" in msg:
                # fs/* and terminal/* were not offered in initialize; anything else is unknown
                await self.write({"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "Not supported"}})
            # Other notifications (e.g. account status, which carries the user's email) stay here
        for future in self.waiting.values():
            if not future.done():
                future.set_result({"error": {"message": "The agent has stopped"}})
        self.host.on_adapter_exit(self)

    async def drain_stderr(self):
        # Unread, a full stderr pipe would stall the agent
        async for _ in self.proc.stderr:
            pass


class Session:
    def __init__(self, sid, agent_id, cwd, title=""):
        self.sid, self.agent_id, self.cwd, self.title = sid, agent_id, cwd, title
        self.adapter = None
        self.log = []          # [(seq, update)], what a phone needs to redraw the chat
        self.seq = 0
        self.unsent = []       # updates waiting for the next flush
        self.flush_handle = None
        self.pending = {}      # rid -> (adapter, rpc id, option ids, request params)
        self.state = "idle"    # idle | thinking | needs_you | error
        self.modes, self.mode = [], None
        self.updated = time.time()
        # Started with `tp` in the PC terminal: "pc" while it runs there, "moving" while it
        # closes for the phone, "phone" once the phone has it. None for chats begun on the phone.
        self.owner = None

    def summary(self):
        return {"sid": self.sid, "agent": self.agent_id, "cwd": self.cwd, "title": self.title,
                "state": self.state, "updated": self.updated, "live": self.adapter is not None,
                "owner": self.owner}


def read_pc_session():
    """What `tp` (tp.ps1) last wrote about the agent it runs in the PC terminal, or None."""
    try:
        with open(PC_SESSION_FILE, encoding="utf-8-sig") as f:  # PowerShell 5 writes a BOM
            d = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(d, dict) or d.get("agent") not in HANDOFF_AGENTS or not isinstance(d.get("sid"), str):
        return None
    return d


def write_pc_owner(d, owner):
    d = {**d, "owner": owner}
    tmp = PC_SESSION_FILE + "." + uuid.uuid4().hex
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f)
    os.replace(tmp, PC_SESSION_FILE)
    return d


class AcpHost:
    def __init__(self, send, make_env, pty_write=None):
        self.send = send            # thread-safe send to the relay (agent.send_to_relay)
        self.make_env = make_env    # environment for child processes, inherited session vars removed
        self.pty_write = pty_write  # types into the PC terminal, for handing a `tp` session over
        self.adapters = {}
        self.sessions = {}
        self.next_rid = 0
        self.load_index()
        # The terminal that ran `tp` before is gone with the old PC agent
        try:
            os.remove(PC_SESSION_FILE)
        except OSError:
            pass
        if pty_write:
            asyncio.get_running_loop().create_task(self.watch_pc_session())

    # ── Phone messages ──────────────────────────────────────────────────────

    async def handle(self, msg):
        kind = msg.get("type")
        sid = msg.get("sid")
        try:
            if kind == "CHAT_LIST":
                self.send_list()
            elif kind == "CHAT_DIRS":
                self.send_dirs(msg.get("path") or os.path.expanduser("~"))
            elif kind == "CHAT_NEW":
                await self.new_session(msg.get("agent"), msg.get("cwd"))
            elif kind == "CHAT_OPEN":
                await self.open_session(sid, msg.get("since"))
            elif kind == "CHAT_PROMPT":
                await self.prompt(sid, msg.get("text"))
            elif kind == "CHAT_ANSWER":
                self.answer(sid, msg.get("rid"), msg.get("optionId"))
            elif kind == "CHAT_CANCEL":
                await self.cancel(sid)
            elif kind == "CHAT_MODE":
                await self.set_mode(sid, msg.get("modeId"))
            elif kind == "CHAT_CLOSE":
                await self.close(sid)
            elif kind == "CHAT_TAKEOVER":
                await self.take_over(sid)
            elif kind == "CHAT_GIVEBACK":
                await self.give_back(sid)
        except ChatError as e:
            self.send({"type": "CHAT_ERROR", "sid": sid if isinstance(sid, str) else None, "msg": str(e)})
        except Exception as e:
            # Runs as a detached task: without this the failure would vanish silently
            self.send({"type": "CHAT_ERROR", "sid": sid if isinstance(sid, str) else None, "msg": f"PC agent error: {type(e).__name__}: {e}"[:300]})

    def session(self, sid) -> Session:
        s = self.sessions.get(sid) if isinstance(sid, str) else None
        if not s:
            raise ChatError("That chat no longer exists")
        return s

    def send_list(self):
        sessions = sorted((s.summary() for s in self.sessions.values()), key=lambda s: -s["updated"])
        self.send({"type": "CHAT_SESSIONS", "agents": installed_agents(), "sessions": sessions})

    def send_dirs(self, path):
        real = allowed_dir(path)
        try:
            names = sorted((e.name for e in os.scandir(real) if e.is_dir() and not e.name.startswith((".", "$"))), key=str.lower)
        except OSError:
            names = []
        home = os.path.realpath(os.path.expanduser("~"))
        parent = os.path.dirname(real) if os.path.normcase(real) != os.path.normcase(home) else None
        self.send({"type": "CHAT_DIRS", "path": real, "parent": parent, "dirs": names[:500]})

    async def new_session(self, agent_id, cwd):
        if agent_id not in installed_agents():
            raise ChatError("That agent is not installed on this PC")
        cwd = allowed_dir(cwd)
        adapter = await self.adapter_for(agent_id)
        result = await adapter.call("session/new", {"cwd": cwd, "mcpServers": []})
        s = Session(result["sessionId"], agent_id, cwd)
        s.adapter = adapter
        self.take_modes(s, result.get("modes"))
        self.sessions[s.sid] = s
        self.save_index()
        self.send({"type": "CHAT_CREATED", "sid": s.sid})
        self.send_list()
        self.send_sync(s, 0)

    async def open_session(self, sid, since):
        s = self.session(sid)
        if s.adapter is None and s.owner in ("pc", "moving"):
            # The PC terminal holds it: loading it here too would put two writers on one session
            self.send_sync(s, 0)
            return
        if s.adapter is None:
            # Known from an earlier run of the PC agent: the agent replays the history itself
            adapter = await self.adapter_for(s.agent_id)
            if not adapter.capabilities.get("loadSession"):
                raise ChatError("This agent cannot reopen old chats")
            s.adapter = adapter
            s.log, s.seq = [], 0
            try:
                result = await adapter.call("session/load", {"sessionId": s.sid, "cwd": s.cwd, "mcpServers": []})
            except ChatError:
                s.adapter = None
                raise
            self.take_modes(s, result.get("modes"))
            self.flush(s)
            since = 0
        self.send_sync(s, since if isinstance(since, int) and since >= 0 else 0)

    async def prompt(self, sid, text):
        s = self.session(sid)
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
            raise ChatError("Message is empty or too long")
        if s.owner in ("pc", "moving"):
            raise ChatError("This chat is open in the PC terminal. Take it over first.")
        if s.adapter is None:
            await self.open_session(sid, 0)
        if s.state in ("thinking", "needs_you"):
            raise ChatError("Wait for the current reply, or stop it first")
        if not s.title:
            s.title = " ".join(text.split())[:80]
        # The agent does not echo the prompt back, so the chat log records it here
        self.on_update(s.sid, {"sessionUpdate": "user_message_chunk", "content": {"type": "text", "text": text}})
        self.set_state(s, "thinking")
        self.save_index()
        asyncio.get_running_loop().create_task(self.run_prompt(s, text))

    async def run_prompt(self, s, text):
        stop = None
        try:
            result = await s.adapter.call("session/prompt", {"sessionId": s.sid, "prompt": [{"type": "text", "text": text}]})
            stop = result.get("stopReason")
        except ChatError as e:
            self.send({"type": "CHAT_ERROR", "sid": s.sid, "msg": str(e)})
        self.flush(s)
        self.set_state(s, "idle", stop)

    def answer(self, sid, rid, option_id):
        s = self.session(sid)
        entry = s.pending.get(rid)
        if not entry:
            raise ChatError("That question was already answered")
        adapter, rpc_id, option_ids, _ = entry
        if option_id not in option_ids:
            raise ChatError("Not one of the offered answers")
        del s.pending[rid]
        self.reply_permission(adapter, rpc_id, {"outcome": "selected", "optionId": option_id})
        self.send({"type": "CHAT_ANSWERED", "sid": s.sid, "rid": rid})
        if s.state == "needs_you" and not s.pending:
            self.set_state(s, "thinking")

    async def cancel(self, sid):
        s = self.session(sid)
        self.drop_pending(s)
        if s.adapter and s.state != "idle":
            await s.adapter.notify("session/cancel", {"sessionId": s.sid})

    async def set_mode(self, sid, mode_id):
        s = self.session(sid)
        if mode_id not in [m["id"] for m in s.modes]:
            raise ChatError("Not one of this agent's modes")
        if s.adapter is None:
            await self.open_session(sid, 0)
        await s.adapter.call("session/set_mode", {"sessionId": s.sid, "modeId": mode_id})
        s.mode = mode_id
        self.send({"type": "CHAT_MODE", "sid": s.sid, "modes": s.modes, "mode": s.mode})

    async def close(self, sid):
        s = self.session(sid)
        await self.cancel(sid)
        if s.adapter and s.adapter.capabilities.get("sessionCapabilities", {}).get("close") is not None:
            try:
                await s.adapter.call("session/close", {"sessionId": s.sid})
            except ChatError:
                pass
        del self.sessions[s.sid]
        self.save_index()
        self.send_list()

    # ── Handoff with the PC terminal ────────────────────────────────────────
    # `tp claude` (tp.ps1) runs Claude in the PC terminal under a session id it picks and
    # records it in PC_SESSION_FILE. The file's "owner" field is the handshake:
    #   pc -> phone-wanted (we ask Claude to exit) -> phone (tp saw it exit; we load it over ACP)
    #   phone -> pc-request (Enter pressed at the PC, or Give back here) -> pc (we let go; tp resumes)
    # Each side writes only while the other waits, so the file never has two writers at once.

    async def watch_pc_session(self):
        while True:
            await asyncio.sleep(1)
            try:
                await self.check_pc_session()
            except Exception:
                pass  # a half-written file reads again next second

    async def check_pc_session(self):
        d = read_pc_session()
        changed = False
        for s in self.sessions.values():
            if s.owner and (not d or d["sid"] != s.sid):
                # tp has ended: what remains is an ordinary chat the phone may reopen
                s.owner = None
                changed = True
        if d:
            s = self.sessions.get(d["sid"])
            if not s:
                s = Session(d["sid"], d["agent"], str(d.get("cwd", "")))
                s.owner = "pc"
                self.sessions[s.sid] = s
                self.save_index()
                changed = True
            owner = d.get("owner")
            if owner == "phone" and s.owner == "moving":
                s.owner = "phone"
                changed = True
                try:
                    await self.open_session(s.sid, 0)
                except ChatError as e:
                    self.send({"type": "CHAT_ERROR", "sid": s.sid, "msg": str(e)})
            elif owner == "pc-request":
                await self.release(s, d)
                changed = True
            elif owner == "pc" and s.owner not in ("pc", "moving"):
                s.owner = "pc"
                changed = True
        if changed:
            self.send_list()

    async def take_over(self, sid):
        s = self.session(sid)
        d = read_pc_session()
        if s.owner != "pc" or not d or d["sid"] != sid or d.get("owner") != "pc":
            raise ChatError("This chat is not running in the PC terminal")
        write_pc_owner(d, "phone-wanted")
        s.owner = "moving"
        self.send_list()
        # Esc drops whatever is half-typed or running; /exit then closes Claude. If it is
        # still open a few seconds later, Ctrl+C twice is Claude's other way out.
        self.pty_write("\x1b")
        await asyncio.sleep(0.4)
        self.pty_write("/exit\r")
        await asyncio.sleep(8)
        d = read_pc_session()
        if d and d["sid"] == sid and d.get("owner") == "phone-wanted":
            self.pty_write("\x03")
            await asyncio.sleep(0.6)
            self.pty_write("\x03")

    async def give_back(self, sid):
        s = self.session(sid)
        d = read_pc_session()
        if s.owner != "phone" or not d or d["sid"] != sid:
            raise ChatError("This chat did not come from the PC terminal")
        await self.release(s, d)
        self.pty_write("\r")  # tp is waiting for Enter at the PC
        self.send_list()

    async def release(self, s, d):
        """Hand the session back to the PC terminal: stop using it here, then let tp resume it."""
        if s.adapter:
            await self.cancel(s.sid)
            if s.adapter.capabilities.get("sessionCapabilities", {}).get("close") is not None:
                try:
                    await s.adapter.call("session/close", {"sessionId": s.sid})
                except ChatError:
                    pass
            s.adapter = None
        if s.state != "idle":
            self.set_state(s, "idle")
        s.owner = "pc"
        write_pc_owner(d, "pc")
        self.send_sync(s, s.seq)

    # ── Agent messages ──────────────────────────────────────────────────────

    def on_update(self, sid, update):
        s = self.sessions.get(sid)
        if not s:
            return
        kind = update.get("sessionUpdate")
        if kind == "usage_update":
            return  # token counts after every step; the phone shows none of it
        if kind == "session_info_update" and isinstance(update.get("title"), str) and update["title"].strip():
            s.title = " ".join(update["title"].split())[:80]
            self.save_index()
            self.send_list()
        if kind == "current_mode_update":
            s.mode = update.get("currentModeId")
            self.send({"type": "CHAT_MODE", "sid": s.sid, "modes": s.modes, "mode": s.mode})
        s.unsent.append(update)
        if not s.flush_handle:
            s.flush_handle = asyncio.get_running_loop().call_later(FLUSH_SECONDS, self.flush, s)

    def flush(self, s):
        if s.flush_handle:
            s.flush_handle.cancel()
            s.flush_handle = None
        if not s.unsent:
            return
        merged = []
        for u in s.unsent:
            last = merged[-1] if merged else None
            # Streaming text arrives a few characters at a time; one event per burst is enough
            if (last and u.get("sessionUpdate") == last.get("sessionUpdate")
                    and u.get("sessionUpdate") in ("agent_message_chunk", "agent_thought_chunk", "user_message_chunk")
                    and (u.get("content") or {}).get("type") == "text" == (last.get("content") or {}).get("type")):
                merged[-1] = {**last, "content": {"type": "text", "text": last["content"]["text"] + u["content"].get("text", "")}}
            else:
                merged.append(u)
        s.unsent = []
        events = []
        for u in merged:
            s.seq += 1
            events.append([s.seq, u])
        s.log.extend(events)
        del s.log[:-MAX_LOG]
        s.updated = time.time()
        self.send({"type": "CHAT_EVENT", "sid": s.sid, "events": events})

    def on_permission(self, adapter, rpc_id, params):
        s = self.sessions.get(params.get("sessionId"))
        options = params.get("options") or []
        if not s:
            self.reply_permission(adapter, rpc_id, {"outcome": "cancelled"})
            return
        self.flush(s)  # the tool card it belongs to must reach the phone first
        self.next_rid += 1
        rid = str(self.next_rid)
        s.pending[rid] = (adapter, rpc_id, [o.get("optionId") for o in options], params)
        self.send({"type": "CHAT_PERMISSION", "sid": s.sid, "rid": rid, "toolCall": params.get("toolCall"), "options": options})
        self.set_state(s, "needs_you")

    def on_adapter_exit(self, adapter):
        if self.adapters.get(adapter.agent_id) is adapter:
            del self.adapters[adapter.agent_id]
        for s in self.sessions.values():
            if s.adapter is adapter:
                s.adapter = None
                s.pending.clear()
                if s.state != "idle":
                    self.set_state(s, "error", "agent stopped")

    # ── Helpers ─────────────────────────────────────────────────────────────

    async def adapter_for(self, agent_id) -> Adapter:
        adapter = self.adapters.get(agent_id)
        if adapter and adapter.proc.returncode is None:
            return adapter
        node = shutil.which("node")
        if not node:
            raise ChatError("Node.js is not installed on this PC")
        a = AGENTS[agent_id]
        # shortcut: adapters stay up until the PC agent exits (~100 MB each); stop idle ones if memory matters
        proc = await asyncio.create_subprocess_exec(
            node, a["entry"], *a["args"], stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, env=self.make_env(), cwd=os.path.expanduser("~"),
            limit=16 * 1024 * 1024)  # history replays and diffs exceed asyncio's 64 KB line default
        adapter = Adapter(self, agent_id, proc)
        loop = asyncio.get_running_loop()
        loop.create_task(adapter.read())
        loop.create_task(adapter.drain_stderr())
        try:
            init = await asyncio.wait_for(adapter.call("initialize", {
                "protocolVersion": 1,
                # The agents use their own file and shell tools; the phone is not a file system
                "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False}, "terminal": False},
                "clientInfo": {"name": "termpilot", "version": "1"},
            }), 60)
        except (ChatError, asyncio.TimeoutError):
            proc.kill()
            raise ChatError(f"{a['name']} did not start")
        adapter.capabilities = init.get("agentCapabilities") or {}
        self.adapters[agent_id] = adapter
        return adapter

    def take_modes(self, s, modes):
        modes = modes or {}
        s.modes = [{"id": m["id"], "name": m.get("name", m["id"])} for m in modes.get("availableModes", [])
                   if m.get("id") not in UNSAFE_MODES]
        s.mode = modes.get("currentModeId")

    def set_state(self, s, state, reason=None):
        s.state = state
        self.send({"type": "CHAT_STATE", "sid": s.sid, "state": state, "reason": reason})

    def send_sync(self, s, since):
        self.flush(s)
        events = [e for e in s.log if e[0] > since]
        # "first" tells the phone where a sync starts: from 0 it redraws the chat from scratch
        page, size, first = [], 0, True
        for e in events:
            n = len(json.dumps(e))
            if page and size + n > SYNC_PAGE_BYTES:
                self.send({"type": "CHAT_SYNC", "sid": s.sid, "events": page, "since": since, "first": first, "more": True})
                page, size, first = [], 0, False
            page.append(e)
            size += n
        pending = [{"rid": rid, "toolCall": p[3].get("toolCall"), "options": p[3].get("options")} for rid, p in s.pending.items()]
        self.send({"type": "CHAT_SYNC", "sid": s.sid, "events": page, "since": since, "first": first, "more": False,
                   "summary": s.summary(), "modes": s.modes, "mode": s.mode, "pending": pending})

    def reply_permission(self, adapter, rpc_id, outcome):
        asyncio.get_running_loop().create_task(adapter.write({"jsonrpc": "2.0", "id": rpc_id, "result": {"outcome": outcome}}))

    def drop_pending(self, s):
        for adapter, rpc_id, _, _ in s.pending.values():
            self.reply_permission(adapter, rpc_id, {"outcome": "cancelled"})
        s.pending.clear()

    def load_index(self):
        try:
            with open(INDEX_FILE, encoding="utf-8") as f:
                for row in json.load(f):
                    if row.get("agent") in AGENTS and isinstance(row.get("sid"), str):
                        s = Session(row["sid"], row["agent"], row.get("cwd", ""), row.get("title", ""))
                        s.updated = row.get("updated", 0)
                        self.sessions[s.sid] = s
        except (OSError, ValueError):
            pass

    def save_index(self):
        rows = [{"sid": s.sid, "agent": s.agent_id, "cwd": s.cwd, "title": s.title, "updated": s.updated}
                for s in self.sessions.values()]
        os.makedirs(os.path.dirname(INDEX_FILE), exist_ok=True)
        tmp = INDEX_FILE + "." + uuid.uuid4().hex
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(rows, f)
        os.replace(tmp, INDEX_FILE)
