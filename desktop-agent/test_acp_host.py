"""Self-check for acp_host against a fake ACP agent. Run: python test_acp_host.py

Covers what the phone may send that must be refused (unknown agent, folder outside home,
forged permission answer, unsafe mode), streaming and merging of text, a permission request
surviving a resync, a 100 KB JSON line, and reopening a chat after the PC agent restarts.
"""
import asyncio
import os
import sys
import tempfile

import acp_host

FAKE_AGENT = r'''
import json, sys
def send(m): sys.stdout.write(json.dumps(m) + "\n"); sys.stdout.flush()
def update(sid, u): send({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": sid, "update": u}})
waiting = None
for line in sys.stdin:
    m = json.loads(line)
    method, mid, p = m.get("method"), m.get("id"), m.get("params", {})
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": 1, "agentCapabilities": {"loadSession": True}}})
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": mid, "result": {"sessionId": "s1", "modes": {"currentModeId": "default",
              "availableModes": [{"id": "default", "name": "Manual"}, {"id": "bypassPermissions", "name": "Bypass"}]}}})
    elif method == "session/load":
        update(p["sessionId"], {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "replayed"}})
        send({"jsonrpc": "2.0", "id": mid, "result": {}})
    elif method == "session/prompt":
        for part in ("Hel", "lo"):
            update(p["sessionId"], {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": part}})
        update(p["sessionId"], {"sessionUpdate": "tool_call", "toolCallId": "t1", "title": "Write a.txt", "kind": "edit",
                                "content": [{"type": "diff", "path": "a.txt", "oldText": None, "newText": "x" * 100000}]})
        waiting = mid
        send({"jsonrpc": "2.0", "id": 900, "method": "session/request_permission", "params": {"sessionId": p["sessionId"],
              "toolCall": {"toolCallId": "t1"}, "options": [{"optionId": "yes", "kind": "allow_once", "name": "Allow"},
                                                           {"optionId": "no", "kind": "reject_once", "name": "Deny"}]}})
    elif mid == 900:
        choice = m["result"]["outcome"].get("optionId")
        update("s1", {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "answer:" + str(choice)}})
        send({"jsonrpc": "2.0", "id": waiting, "result": {"stopReason": "end_turn"}})
'''


async def main():
    work = tempfile.mkdtemp()  # under %TEMP%, which is inside the home folder
    fake = os.path.join(work, "fake_agent.py")
    with open(fake, "w") as f:
        f.write(FAKE_AGENT)
    acp_host.AGENTS = {"fake": {"name": "Fake", "entry": fake, "args": []}}
    acp_host.INDEX_FILE = os.path.join(work, "sessions.json")
    acp_host.shutil.which = lambda name: sys.executable  # run the fake with Python, not node

    sent = []
    host = acp_host.AcpHost(sent.append, lambda: dict(os.environ))

    async def ask(msg, settle=0.3):
        sent.clear()
        await host.handle(msg)
        await asyncio.sleep(settle)
        return list(sent)

    def kinds(msgs, kind):
        return [m for m in msgs if m["type"] == kind]

    out = await ask({"type": "CHAT_NEW", "agent": "evil", "cwd": work})
    assert kinds(out, "CHAT_ERROR"), "unknown agent must be refused"
    for bad in ("C:\\Windows", "\\\\server\\share", "", os.path.join(work, "missing")):
        out = await ask({"type": "CHAT_NEW", "agent": "fake", "cwd": bad})
        assert kinds(out, "CHAT_ERROR") and not kinds(out, "CHAT_CREATED"), f"folder {bad!r} must be refused"

    out = await ask({"type": "CHAT_NEW", "agent": "fake", "cwd": work}, settle=2)
    assert kinds(out, "CHAT_CREATED")[0]["sid"] == "s1"
    sync = kinds(out, "CHAT_SYNC")[-1]
    assert [m["id"] for m in sync["modes"]] == ["default"], "bypass mode must not be offered"
    out = await ask({"type": "CHAT_MODE", "sid": "s1", "modeId": "bypassPermissions"})
    assert kinds(out, "CHAT_ERROR"), "unsafe mode must be refused"

    out = await ask({"type": "CHAT_PROMPT", "sid": "s1", "text": "hi"}, settle=1)
    perm = kinds(out, "CHAT_PERMISSION")[0]
    texts = [e[1]["content"]["text"] for m in kinds(out, "CHAT_EVENT") for e in m["events"]
             if e[1]["sessionUpdate"] == "agent_message_chunk"]
    assert texts == ["Hello"], f"text chunks should merge into one event, got {texts}"
    diff = [e[1] for m in kinds(out, "CHAT_EVENT") for e in m["events"] if e[1]["sessionUpdate"] == "tool_call"][0]
    assert len(diff["content"][0]["newText"]) == 100000, "100 KB line must arrive whole"
    assert host.sessions["s1"].state == "needs_you"

    out = await ask({"type": "CHAT_OPEN", "sid": "s1", "since": 0})
    assert kinds(out, "CHAT_SYNC")[-1]["pending"][0]["rid"] == perm["rid"], "resync must re-send the open question"

    out = await ask({"type": "CHAT_ANSWER", "sid": "s1", "rid": perm["rid"], "optionId": "always-everything"})
    assert kinds(out, "CHAT_ERROR"), "forged answer must be refused"
    out = await ask({"type": "CHAT_ANSWER", "sid": "s1", "rid": perm["rid"], "optionId": "yes"}, settle=1)
    assert any(e[1]["content"]["text"] == "answer:yes" for m in kinds(out, "CHAT_EVENT") for e in m["events"])
    assert host.sessions["s1"].state == "idle" and kinds(out, "CHAT_STATE")[-1]["reason"] == "end_turn"

    log = host.sessions["s1"].log
    out = await ask({"type": "CHAT_OPEN", "sid": "s1", "since": log[-2][0]})
    assert [e[0] for e in kinds(out, "CHAT_SYNC")[-1]["events"]] == [log[-1][0]], "sync sends only what the phone lacks"

    # The PC agent restarts: the chat comes back from the index and the agent replays it
    for a in host.adapters.values():
        a.proc.kill()
    again = acp_host.AcpHost(sent.append, lambda: dict(os.environ))
    host = again
    out = await ask({"type": "CHAT_LIST"})
    assert [s["sid"] for s in kinds(out, "CHAT_SESSIONS")[0]["sessions"]] == ["s1"]
    out = await ask({"type": "CHAT_OPEN", "sid": "s1", "since": 7}, settle=2)
    events = kinds(out, "CHAT_SYNC")[-1]["events"]
    assert [e[1]["content"]["text"] for e in events] == ["replayed"], "reopened chat starts from the agent's replay"
    for a in host.adapters.values():
        a.proc.kill()
    await asyncio.sleep(0.2)
    print("acp_host: all checks pass")


if __name__ == "__main__":
    asyncio.run(main())
