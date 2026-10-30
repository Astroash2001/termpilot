"""Self-check for the Running-on-your-PC cards: reading a session's latest messages from its
transcript, and what a card is told. Run: venv\\Scripts\\python.exe test_running.py"""
import asyncio
import json
import os
import tempfile

import acp_host

path = os.path.join(tempfile.mkdtemp(), "s.jsonl")
acp_host.transcript = lambda sid: path


def write(*records, pad=0):
    with open(path, "w", encoding="utf-8") as f:
        f.write("x" * pad + "\n")  # a huge earlier line the tail read may cut in half
        for r in records:
            f.write(json.dumps(r) + "\n")


user = lambda text: {"type": "user", "message": {"content": text}}
reply = lambda text: {"type": "assistant", "message": {"content": [{"type": "thinking", "thinking": "hm"}, {"type": "text", "text": text}]}}

write(user("fix the upload test"), reply("Looking at it."), {"type": "attachment"},
      user("<command-name>/clear</command-name>"), {**reply("side job"), "isSidechain": True},
      user([{"type": "tool_result", "content": "ok"}]), reply("Done: the test passes."),
      pad=acp_host.TAIL + 10)
got = acp_host.recent_messages("s", 5)
assert got == [{"role": "user", "text": "fix the upload test"}, {"role": "agent", "text": "Looking at it."},
               {"role": "agent", "text": "Done: the test passes."}], got
assert acp_host.recent_messages("s", 1) == [{"role": "agent", "text": "Done: the test passes."}]


async def main():
    host = acp_host.AcpHost(lambda m: None, lambda: {})
    s = acp_host.Session("s", "claude", "C:/work/termpilot")
    s.owner, s.window, s.status = "pc", {"pid": 1, "shells": [], "at": 0}, "busy"
    host.sessions = {"s": s}
    assert await host.refresh_last() and s.last == "Done: the test passes."
    assert not await host.refresh_last(), "unchanged transcript is not read again"
    card = s.summary()
    assert card["last"] == "Done: the test passes." and card["busy"] and card["owner"] == "pc"
    s.status = "idle"
    assert not s.summary()["busy"]

    # A `tp` session in the PC terminal: Claude's own status file says whether it is working
    tp = acp_host.Session("t", "claude", "C:/work/termpilot")
    tp.owner = "pc"
    host.sessions = {"t": tp}
    acp_host.read_pc_session = lambda: {"sid": "t", "agent": "claude", "owner": "pc"}
    acp_host.read_laptop_sessions = lambda: {"t": {"pid": 2, "cwd": "C:/work/termpilot", "status": "busy"}}
    host.send_list = lambda: None
    await host.check_laptop_sessions()
    assert tp.summary()["busy"] and tp.window is None, "tp stays a terminal session, now marked working"

asyncio.run(main())
print("running cards: all checks pass")
