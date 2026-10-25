"""Self-check for the PC <-> phone handoff (tp.ps1 + acp_host). Run: python test_handoff.py

A hidden ConPTY runs PowerShell with tp loaded and a fake `claude` that just waits for /exit.
The phone side is acp_host driven directly, with a fake ACP agent standing in for Claude.
Uses the real ~/.termpilot/pc-session.json, so do not run it while a `tp` session is open.
"""
import asyncio
import os
import sys
import tempfile
import threading
import time

from winpty import PtyProcess

import acp_host
from test_acp_host import FAKE_AGENT

HERE = os.path.dirname(os.path.abspath(__file__))
FAKE_CLAUDE = ("function claude { Write-Host \"FAKE-CLAUDE $args\"; "
               "while ($true) { $l = [Console]::ReadLine(); if ($l -like '*/exit') { break } } }")


async def main():
    work = tempfile.mkdtemp()
    fake = os.path.join(work, "fake_agent.py")
    with open(fake, "w") as f:
        f.write(FAKE_AGENT.replace('"s1"', 'p["sessionId"]'))
    acp_host.AGENTS = {"claude": {"name": "Claude Code", "entry": fake, "args": []}}
    acp_host.INDEX_FILE = os.path.join(work, "sessions.json")
    acp_host.shutil.which = lambda name: sys.executable

    pty = PtyProcess.spawn(["powershell.exe", "-NoLogo", "-NoProfile", "-NoExit", "-Command",
                            f". ([ScriptBlock]::Create([IO.File]::ReadAllText('{os.path.join(HERE, 'tp.ps1')}'))); {FAKE_CLAUDE}"],
                           cwd=work, dimensions=(30, 120))
    screen = []

    def read():
        try:
            while True:
                screen.append(pty.read(4096))
        except EOFError:
            pass
    threading.Thread(target=read, daemon=True).start()

    async def wait_for(check, what, seconds=20):
        for _ in range(seconds * 10):
            if check():
                return
            await asyncio.sleep(0.1)
        raise AssertionError(f"timed out waiting for {what}; terminal: {''.join(screen)[-400:]!r}")

    sent = []
    host = acp_host.AcpHost(sent.append, lambda: dict(os.environ), pty.write)
    await asyncio.sleep(2)
    pty.write("tp claude --model x\r")
    await wait_for(lambda: "FAKE-CLAUDE --session-id" in "".join(screen), "claude to start under tp")
    d = acp_host.read_pc_session()
    assert d and d["owner"] == "pc" and d["agent"] == "claude", d
    sid = d["sid"]
    await wait_for(lambda: sid in host.sessions and host.sessions[sid].owner == "pc", "phone to list the PC session")

    sent.clear()
    await host.handle({"type": "CHAT_PROMPT", "sid": sid, "text": "hi"})
    assert any(m["type"] == "CHAT_ERROR" for m in sent), "no prompting a session the PC terminal holds"

    asyncio.get_running_loop().create_task(host.handle({"type": "CHAT_TAKEOVER", "sid": sid}))
    await wait_for(lambda: "on your phone now" in "".join(screen), "tp to hand Claude over")
    await wait_for(lambda: host.sessions[sid].owner == "phone" and host.sessions[sid].adapter, "phone to load the session")
    assert any(m["type"] == "CHAT_SYNC" and m["first"] for m in sent), "phone gets the session's history"

    mark = len("".join(screen))
    await host.handle({"type": "CHAT_GIVEBACK", "sid": sid})
    await wait_for(lambda: f"FAKE-CLAUDE --resume {sid}" in "".join(screen)[mark:], "tp to resume Claude on the PC")
    await wait_for(lambda: host.sessions[sid].owner == "pc", "phone to see it back on the PC")
    assert host.sessions[sid].adapter is None, "phone side let go of the session"

    pty.write("/exit\r")
    await wait_for(lambda: acp_host.read_pc_session() is None, "tp to clear its file on exit")
    await wait_for(lambda: host.sessions[sid].owner is None, "session to become an ordinary chat")
    pty.terminate(force=True)
    for a in host.adapters.values():
        a.proc.kill()
    await asyncio.sleep(0.3)
    print("handoff: all checks pass")


if __name__ == "__main__":
    asyncio.run(main())
