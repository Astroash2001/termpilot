"""Antigravity (agy) as an ACP agent, so it can run as a chat on the phone.

agy has no Agent Client Protocol mode, but `agy -p <prompt> --output-format stream-json` streams
a turn as events. This program speaks ACP on stdio to acp_host.py and runs one such `agy -p`
per prompt in the chat's folder, continuing the same agy conversation each time.

Headless agy cannot ask for permission: it edits files in the folder on its own and refuses
shell commands. Nothing here changes that (no --dangerously-skip-permissions); refused commands
are shown in the chat so they can be run in the TermPilot terminal instead.
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import uuid

# chat id -> {"cwd", "conversation"}; agy's conversation id is known only after the first turn
SESSIONS_FILE = os.path.join(os.path.expanduser("~"), ".termpilot", "agy-sessions.json")
# The tests point this at a fake agy
AGY = json.loads(os.environ["TERMPILOT_AGY_CMD"]) if os.environ.get("TERMPILOT_AGY_CMD") else [shutil.which("agy") or "agy"]
KINDS = {"write_file": "edit", "replace_file_content": "edit", "multi_replace_file_content": "edit",
         "view_file": "read", "read_file": "read", "list_dir": "read", "run_command": "execute",
         "grep_search": "search", "find_by_name": "search", "search_web": "fetch", "read_url_content": "fetch"}

out_lock = threading.Lock()
sessions_lock = threading.Lock()  # a turn's thread saves while the main thread may add a chat
running = {}  # chat id -> the agy process of its current turn
cancelled = set()


def send(msg):
    with out_lock:
        sys.stdout.write(json.dumps(msg) + "\n")
        sys.stdout.flush()


def update(sid, u):
    send({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": sid, "update": u}})


def load():
    try:
        with open(SESSIONS_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save(sessions):
    os.makedirs(os.path.dirname(SESSIONS_FILE), exist_ok=True)
    tmp = SESSIONS_FILE + "." + uuid.uuid4().hex
    with sessions_lock, open(tmp, "w", encoding="utf-8") as f:
        json.dump(sessions, f)
    os.replace(tmp, SESSIONS_FILE)


def tool_card(sid, ev, conversation):
    """One agy tool step as an ACP tool call: started, finished or refused."""
    info = ev.get("tool_info") or {}
    params = info.get("parameters") or {}
    name = ev.get("tool_name") or info.get("name") or "tool"
    detail = params.get("CommandLine") or params.get("Path") or params.get("AbsolutePath") or ""
    call = {"toolCallId": f"{conversation}-{ev.get('step_index')}", "title": f"{name} {detail}".strip()[:200],
            "kind": KINDS.get(name, "fetch" if name.startswith("browser_") else "other")}
    if ev.get("state") == "ACTIVE":
        update(sid, {"sessionUpdate": "tool_call", **call, "status": "in_progress",
                     **({"rawInput": {"command": params["CommandLine"]}} if "CommandLine" in params else {})})
        return
    error = (info.get("error") or {}).get("message", "")
    update(sid, {"sessionUpdate": "tool_call_update", **call, "status": "failed" if error else "completed",
                 **({"content": [{"type": "content", "content": {"type": "text", "text": error}}]} if error else {})})


def prompt(rpc_id, sid, text, sessions):
    s = sessions[sid]
    # --print=<text>: a message can never be read as one of agy's flags
    cmd = [*AGY, "--print=" + text, "--output-format", "stream-json"]
    if s.get("conversation"):
        cmd += ["--conversation", s["conversation"]]
    # shortcut: the prompt rides on the command line (Windows caps it near 32,000 characters); use stream-json input if that bites
    try:
        proc = subprocess.Popen(cmd, cwd=s["cwd"], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except OSError as e:
        # A deleted folder, agy gone, or a message past Windows' command-line limit: answer, or the chat waits forever
        send({"jsonrpc": "2.0", "id": rpc_id, "error": {"code": -32000, "message": f"Antigravity could not start: {e}"[:300]}})
        return
    running[sid] = proc
    result = None
    for line in proc.stdout:
        try:
            msg = json.loads(line)
        except ValueError:
            continue  # agy also prints plain notes, like why a command was refused
        ev = msg.get("step_update") or {}
        conversation = ev.get("conversation_id") or msg.get("conversation_id")
        if conversation and conversation != s.get("conversation"):
            s["conversation"] = conversation
            save(sessions)
        if ev.get("step_type") == "agent_response" and ev.get("text_delta"):
            update(sid, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": ev["text_delta"]}})
        elif ev.get("step_type") == "tool" and ev.get("state") in ("ACTIVE", "DONE", "ERROR"):
            tool_card(sid, ev, s.get("conversation"))
        elif msg.get("event") == "result":
            result = msg["result"]
    proc.wait()
    running.pop(sid, None)
    if result and result.get("denied_actions"):
        update(sid, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text":
               "\n\nAntigravity cannot ask for your OK from a chat, so it was not allowed to run commands. "
               "Run them yourself in the TermPilot terminal."}})
    if sid in cancelled:
        cancelled.discard(sid)
        send({"jsonrpc": "2.0", "id": rpc_id, "result": {"stopReason": "cancelled"}})
    elif result is None:
        send({"jsonrpc": "2.0", "id": rpc_id, "error": {"code": -32000, "message": "Antigravity stopped without an answer. Is agy signed in?"}})
    else:
        send({"jsonrpc": "2.0", "id": rpc_id, "result": {"stopReason": "end_turn"}})


def main():
    sessions = load()
    for line in sys.stdin:
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        method, rpc_id, p = msg.get("method"), msg.get("id"), msg.get("params") or {}
        reply = lambda result: send({"jsonrpc": "2.0", "id": rpc_id, "result": result})
        if method == "initialize":
            reply({"protocolVersion": 1, "agentCapabilities": {"loadSession": True}})
        elif method == "session/new":
            sid = str(uuid.uuid4())
            with sessions_lock:
                sessions[sid] = {"cwd": p["cwd"]}
            save(sessions)
            reply({"sessionId": sid})
        elif method == "session/load":
            # agy keeps the conversation itself; the phone starts from an empty screen
            # shortcut: no history replay, agy offers no way to read a past conversation back
            if p.get("sessionId") in sessions:
                reply({})
            else:
                send({"jsonrpc": "2.0", "id": rpc_id, "error": {"code": -32000, "message": "Antigravity no longer knows this chat"}})
        elif method == "session/prompt":
            sid = p.get("sessionId")
            if sid not in sessions:
                send({"jsonrpc": "2.0", "id": rpc_id, "error": {"code": -32000, "message": "Antigravity no longer knows this chat"}})
                continue
            text = "\n".join(c.get("text", "") for c in p.get("prompt") or [] if c.get("type") == "text")
            threading.Thread(target=prompt, args=(rpc_id, sid, text, sessions), daemon=True).start()
        elif method == "session/cancel":
            proc = running.get(p.get("sessionId"))
            if proc:
                cancelled.add(p["sessionId"])
                proc.kill()
        elif rpc_id is not None:
            send({"jsonrpc": "2.0", "id": rpc_id, "error": {"code": -32601, "message": "Not supported"}})


if __name__ == "__main__":
    main()
