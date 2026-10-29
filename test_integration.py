"""End-to-end check: phone <-> relay <-> PC agent <-> a fake ACP agent, over real sockets and HTTP.

Run with the relay's Python: backend\\venv\\Scripts\\python.exe test_integration.py

Everything runs in a throwaway home folder (USERPROFILE), so no real phone, device, session or
upload file is touched. The relay runs in-process on a free port; the "PC agent" is a small bridge
doing what agent.py does for chats: the challenge handshake, then CHAT_* to AcpHost and back.

Covers: phone enrollment with a one-time code, the reload banner version, agent health, a chat
with a file attached from the phone, the Files sheet with a ranged download, reopening a past
Claude Code session from disk, and removing a phone (its socket closes and its key stops working).
"""
import asyncio
import json
import os
import sys
import tempfile
import threading
import time
import urllib.request

HOME = tempfile.mkdtemp()
os.environ["USERPROFILE"] = HOME  # before any import reads the home folder
os.environ["TERMPILOT_NGROK"] = "0"
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "desktop-agent")]

import uvicorn
import websockets

import acp_host
import main as relay

FAKE_AGENT = r'''
import json, sys
def send(m): sys.stdout.write(json.dumps(m) + "\n"); sys.stdout.flush()
def update(sid, u): send({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": sid, "update": u}})
for line in sys.stdin:
    m = json.loads(line)
    method, mid, p = m.get("method"), m.get("id"), m.get("params", {})
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": 1, "agentCapabilities": {"loadSession": True}}})
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": mid, "result": {"sessionId": "11111111-2222-3333-4444-555555555555"}})
    elif method == "session/load":
        update(p["sessionId"], {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "replayed " + p["sessionId"]}})
        send({"jsonrpc": "2.0", "id": mid, "result": {}})
    elif method == "session/prompt":
        update(p["sessionId"], {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "echo:" + p["prompt"][0]["text"]}})
        send({"jsonrpc": "2.0", "id": mid, "result": {"stopReason": "end_turn"}})
'''


HOSTS = []  # to stop the fake agents at the end


def free_port():
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def isolate_relay():
    relay.PHONES_FILE = os.path.join(HOME, "phones.json")
    relay.PHONES.clear()
    relay.DEVICES_FILE = os.path.join(HOME, "devices.json")
    with open(relay.DEVICES_FILE, "w") as f:
        json.dump({"pc-1": {"secret_key": "s" * 36, "name": "Test PC"}}, f)
    relay.PUSH_FILE = os.path.join(HOME, "push.json")
    relay.PUSH["subscriptions"] = []


async def pc_agent(url, ready):
    """The chat half of agent.py: authenticate as the PC, then pass CHAT_* to AcpHost."""
    async with websockets.connect(url, max_size=16 * 1024 * 1024) as ws:
        challenge = json.loads(await ws.recv())
        nonce = "a" * 32
        await ws.send(json.dumps({"type": "AUTH", "device_id": "pc-1", "nonce": nonce,
                                  "mac": relay.device_mac("s" * 36, "agent", challenge["nonce"])}))
        assert json.loads(await ws.recv())["type"] == "AUTH_OK"
        loop = asyncio.get_running_loop()
        host = acp_host.AcpHost(lambda m: loop.create_task(ws.send(json.dumps(m))), lambda: dict(os.environ))
        HOSTS.append(host)
        ready.set()
        async for text in ws:
            msg = json.loads(text)
            if str(msg.get("type", "")).startswith("CHAT_"):
                loop.create_task(host.handle(msg))


class Phone:
    def __init__(self, ws):
        self.ws, self.inbox = ws, []

    @classmethod
    async def connect(cls, base, first):
        ws = await websockets.connect(base + "/ws/client", max_size=16 * 1024 * 1024)
        await ws.send(json.dumps(first))
        phone = cls(ws)
        asyncio.get_running_loop().create_task(phone.pump())
        return phone

    async def pump(self):
        try:
            async for text in self.ws:
                self.inbox.append(json.loads(text))
        except websockets.ConnectionClosed:
            pass

    async def send(self, msg):
        await self.ws.send(json.dumps(msg))

    async def wait(self, kind, pred=lambda m: True, timeout=10):
        end = time.time() + timeout
        while time.time() < end:
            for i, m in enumerate(self.inbox):
                if m.get("type") == kind and pred(m):
                    return self.inbox.pop(i)
            await asyncio.sleep(0.05)
        raise AssertionError(f"no {kind} within {timeout}s; got {[m.get('type') for m in self.inbox]}")


def http(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


async def run(port):
    base, http_base = f"ws://127.0.0.1:{port}", f"http://127.0.0.1:{port}"
    project = os.path.join(HOME, "project")
    os.makedirs(project)
    with open(os.path.join(project, "chart.png"), "wb") as f:
        f.write(b"\x89PNG-fake-image-bytes")
    os.makedirs(os.path.join(project, "node_modules"))
    with open(os.path.join(project, "node_modules", "hidden.png"), "wb") as f:
        f.write(b"x")

    ready = asyncio.Event()
    asyncio.get_running_loop().create_task(pc_agent(base + "/ws/agent", ready))
    await asyncio.wait_for(ready.wait(), 10)

    # Enrollment: a bad code is refused, a real one works once and hands out the phone's own key
    bad = await Phone.connect(base, {"type": "AUTH", "enroll": "guess" * 5})
    await asyncio.sleep(0.3)
    assert bad.ws.close_code == 4001, "a made-up enrollment code must be refused"
    code = relay.new_enroll_code()
    phone = await Phone.connect(base, {"type": "AUTH", "enroll": code, "name": "Test phone"})
    key = await phone.wait("DEVICE_KEY")
    ok = await phone.wait("AUTH_OK")
    assert ok["version"] == relay.web_version(), "AUTH_OK carries the web app version for the reload banner"
    await phone.send({"type": "VISIBLE", "visible": True})
    assert (await phone.wait("VERSION"))["version"] == ok["version"], "back on screen, the page checks the version again"
    reuse = await Phone.connect(base, {"type": "AUTH", "enroll": code})
    await asyncio.sleep(0.3)
    assert reuse.ws.close_code == 4001, "an enrollment code works only once"
    assert "hash" in relay.PHONES[key["id"]] and key["key"] not in json.dumps(relay.PHONES), "only a hash of the key is kept"

    # /enroll answers only a browser on this PC, never a web page reaching it by another name
    assert http(http_base + "/enroll", headers={"Host": "evil.example:8000"})[0] == 403
    status, page, _ = http(http_base + "/enroll", headers={"Host": "127.0.0.1:8000"})
    assert status == 200 and b"<svg" in page

    # Health: Claude without a login shows why; with one it is ready
    await phone.send({"type": "CHAT_LIST"})
    listed = await phone.wait("CHAT_SESSIONS")
    assert "Not signed in" in listed["problems"]["claude"]
    os.makedirs(os.path.join(HOME, ".claude"), exist_ok=True)
    open(os.path.join(HOME, ".claude", ".credentials.json"), "w").close()
    await phone.send({"type": "CHAT_LIST"})
    assert (await phone.wait("CHAT_SESSIONS"))["problems"]["claude"] == ""

    # A chat with a file attached from the phone
    await phone.send({"type": "CHAT_NEW", "agent": "claude", "cwd": project})
    sid = (await phone.wait("CHAT_CREATED"))["sid"]
    status, body, _ = http(http_base + "/api/upload", b"notes", {"X-Upload-Ticket": "forged", "X-File-Name": "a.txt"})
    assert status == 403, "an upload needs a ticket from an authenticated phone"
    await phone.send({"type": "UPLOAD_TICKET", "rid": "1"})
    ticket = (await phone.wait("UPLOAD_TICKET"))["ticket"]
    status, body, _ = http(http_base + "/api/upload", b"meeting notes", {"X-Upload-Ticket": ticket, "X-File-Name": "..%2F..%2Fnotes.csv"})
    assert status == 200, body
    upload = json.loads(body)
    assert upload["name"] == "notes.csv", "the name cannot climb out of the staging folder"
    status, _, _ = http(http_base + "/api/upload", b"again", {"X-Upload-Ticket": ticket, "X-File-Name": "b.txt"})
    assert status == 403, "a ticket works once"
    await phone.send({"type": "CHAT_PROMPT", "sid": sid, "text": "read this", "files": [upload["id"], "gone" * 5]})
    await phone.wait("CHAT_ERROR", lambda m: "Attach it again" in m["msg"])
    assert os.path.isdir(os.path.join(HOME, ".termpilot", "uploads", upload["id"])), "one missing file never moves the others"
    await phone.send({"type": "CHAT_PROMPT", "sid": sid, "text": "read this", "files": [upload["id"]]})
    placed = os.path.join(project, ".termpilot", "uploads", "notes.csv")
    reply = await phone.wait("CHAT_EVENT", lambda m: any("echo:" in json.dumps(e) for e in m["events"]))
    assert placed in json.dumps(reply).replace("\\\\", "\\"), "the agent is told where the file is on the PC"
    assert open(placed).read() == "meeting notes"
    assert open(os.path.join(project, ".termpilot", ".gitignore")).read() == "*\n", "uploads stay out of git"

    # Files sheet: lists viewable files, skips node_modules, serves one by token with Range support
    await phone.send({"type": "CHAT_FILES", "sid": sid})
    names = [f["path"] for f in (await phone.wait("CHAT_FILES"))["files"]]
    assert "chart.png" in names and not any("node_modules" in n for n in names), names
    assert os.path.join(".termpilot", "uploads", "notes.csv") in names, "files sent from the phone show too"
    assert not any(n.endswith(".gitignore") for n in names)
    for bad_path in ("..\\outside.png", "node_modules\\hidden.png", os.path.join(HOME, "x.png")):
        await phone.send({"type": "CHAT_FILE", "sid": sid, "path": bad_path})
        await phone.wait("CHAT_ERROR")
    await phone.send({"type": "CHAT_FILE", "sid": sid, "path": "chart.png"})
    link = await phone.wait("CHAT_FILE_URL")
    assert HOME not in json.dumps(link), "the phone gets a token, never the PC path"
    status, body, headers = http(http_base + link["url"], headers={"Range": "bytes=0-3"})
    assert status == 206 and body == b"\x89PNG", (status, body)
    assert headers.get("Cache-Control") == "private, no-store", headers
    assert http(http_base + "/api/file/" + "x" * 32)[0] == 404

    # Past sessions: a Claude Code transcript on disk shows up and reopens as a chat
    past = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    folder = os.path.join(HOME, ".claude", "projects", "C--project")
    os.makedirs(folder)
    with open(os.path.join(folder, past + ".jsonl"), "w") as f:
        f.write(json.dumps({"type": "user", "cwd": project, "message": {"content": "fix the login bug"}}) + "\n")
    await phone.send({"type": "CHAT_HISTORY"})
    items = (await phone.wait("CHAT_HISTORY"))["items"]
    assert [(i["sid"], i["title"]) for i in items] == [(past, "fix the login bug")], items
    await phone.send({"type": "CHAT_RESUME", "agent": "claude", "sid": "../../etc"})
    await phone.wait("CHAT_ERROR")
    await phone.send({"type": "CHAT_RESUME", "agent": "claude", "sid": past})
    assert (await phone.wait("CHAT_CREATED"))["sid"] == past
    replay = await phone.wait("CHAT_SYNC", lambda m: m["sid"] == past)
    assert "replayed " + past in json.dumps(replay)

    # Devices: a second phone, removed from the first; its socket closes and its key stops working
    other = await Phone.connect(base, {"type": "AUTH", "enroll": relay.new_enroll_code(), "name": "Old phone"})
    other_key = await other.wait("DEVICE_KEY")
    await phone.send({"type": "DEVICES"})
    devices = (await phone.wait("DEVICES"))["devices"]
    assert sorted(d["name"] for d in devices) == ["Old phone", "Test phone"]
    assert [d["current"] for d in devices if d["name"] == "Test phone"] == [True]
    await phone.send({"type": "DEVICE_REVOKE", "id": other_key["id"]})
    await phone.wait("DEVICES", lambda m: len(m["devices"]) == 1)
    await asyncio.sleep(0.3)
    assert other.ws.close_code == 4001, "a removed phone is cut off at once"
    again = await Phone.connect(base, {"type": "AUTH", "device": other_key["id"], "key": other_key["key"]})
    await asyncio.sleep(0.3)
    assert again.ws.close_code == 4001, "a removed phone's key no longer works"
    back = await Phone.connect(base, {"type": "AUTH", "device": key["id"], "key": key["key"]})
    await back.wait("AUTH_OK")
    await back.send({"type": "DEVICE_REVOKE", "id": key["id"]})
    await asyncio.sleep(0.3)
    assert back.ws.close_code == 4001 and key["id"] not in relay.PHONES, "a phone can remove itself"
    for adapter in HOSTS[0].adapters.values():
        adapter.proc.kill()
        await adapter.proc.wait()


def main():
    work = os.path.join(HOME, "agent")
    os.makedirs(work)
    fake = os.path.join(work, "fake_agent.py")
    with open(fake, "w") as f:
        f.write(FAKE_AGENT)
    acp_host.AGENTS = {"claude": {"name": "Claude Code", "entry": fake, "args": []}}
    acp_host.INDEX_FILE = os.path.join(HOME, ".termpilot", "sessions.json")
    acp_host.PC_SESSION_FILE = os.path.join(HOME, ".termpilot", "pc-session.json")
    acp_host.CLAUDE_SESSIONS = os.path.join(HOME, ".claude", "sessions")
    acp_host.shutil.which = lambda name: sys.executable  # "node" runs the fake with Python
    isolate_relay()

    port = free_port()
    server = uvicorn.Server(uvicorn.Config(relay.app, host="127.0.0.1", port=port, log_level="warning", lifespan="off"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)
    try:
        asyncio.run(asyncio.wait_for(run(port), 60))
    finally:
        server.should_exit = True  # the fake agent exits when its stdin closes with the loop
    print("integration: all checks pass")


if __name__ == "__main__":
    main()
