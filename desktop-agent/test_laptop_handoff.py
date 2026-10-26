"""Self-check for moving a plain `claude` from a laptop window to the phone and back.
Run: python test_laptop_handoff.py

Real Claude in a hidden console window, real ACP adapter on the phone side. Nothing is prompted
except one tiny haiku prompt (Claude saves a session only once it has a message).
Needs Claude Code and `npm ci --prefix acp` done.
"""
import asyncio
import os
import subprocess
import tempfile
import time

import acp_host
import console_keys
from agent import child_env

HERE = os.path.dirname(os.path.abspath(__file__))


async def main():
    hidden = subprocess.STARTUPINFO()
    hidden.dwFlags, hidden.wShowWindow = subprocess.STARTF_USESHOWWINDOW, 0
    started = time.time()
    shell = subprocess.Popen(["powershell.exe", "-NoLogo", "-NoProfile", "-NoExit", "-Command", "claude --model haiku"], cwd=HERE,
                             env=child_env(), creationflags=subprocess.CREATE_NEW_CONSOLE, startupinfo=hidden)

    async def wait_for(check, what, seconds=60):
        for _ in range(seconds * 4):
            result = check()
            if result:
                return result
            await asyncio.sleep(0.25)
        raise AssertionError(f"timed out waiting for {what}")

    def ours():
        return next((sid for sid, r in acp_host.read_laptop_sessions().items()
                     if os.path.normcase(r["cwd"]) == os.path.normcase(HERE) and r["pid"] != getattr(ours, "old", None)
                     and console_keys.started_at(r["pid"]) / 1e7 - 11644473600 > started - 2), None)

    # Keep the real PC agent's chat list and `tp` file out of it
    work = tempfile.mkdtemp()
    acp_host.INDEX_FILE = os.path.join(work, "sessions.json")
    acp_host.PC_SESSION_FILE = os.path.join(work, "pc-session.json")
    sent = []
    host = acp_host.AcpHost(sent.append, child_env, lambda data: None)
    try:
        sid = await wait_for(ours, "claude to start in the window")
        s = await wait_for(lambda: host.sessions.get(sid) if host.sessions.get(sid) and host.sessions[sid].owner == "pc" else None,
                           "phone to list the laptop session")
        assert s.window and s.summary()["window"], "listed as a laptop window"
        ours.old = s.window["pid"]
        await asyncio.sleep(3)  # let Claude finish drawing before keys arrive

        sent.clear()
        await host.handle({"type": "CHAT_TAKEOVER", "sid": sid})
        assert any("Nothing to move yet" in m.get("msg", "") for m in sent) and s.owner == "pc", "empty session stays put"

        # One tiny prompt so Claude saves the session (a few cents at most on haiku)
        console_keys.type_into(ours.old, "Reply with just the word ok\r")
        await wait_for(lambda: acp_host.read_laptop_sessions().get(sid, {}).get("status") == "busy", "claude to start the reply", 30)
        await wait_for(lambda: acp_host.read_laptop_sessions().get(sid, {}).get("status") == "idle", "claude to finish the reply", 120)

        sent.clear()
        await host.handle({"type": "CHAT_PROMPT", "sid": sid, "text": "hi"})
        assert any(m["type"] == "CHAT_ERROR" for m in sent), "no prompting a session the laptop holds"

        await host.handle({"type": "CHAT_TAKEOVER", "sid": sid})
        assert not [m for m in sent if m["type"] == "CHAT_ERROR" and "PC terminal" not in m["msg"]], sent[-3:]
        assert s.owner == "phone" and s.adapter, "phone holds the session over ACP"
        assert not console_keys.started_at(ours.old), "claude closed in the laptop window"
        assert shell.pid in s.window["shells"], "the window's shell is remembered for Give back"
        assert any(m["type"] == "CHAT_SYNC" and m["sid"] == sid for m in sent), "phone gets the chat"

        await host.handle({"type": "CHAT_GIVEBACK", "sid": sid})
        assert s.owner == "pc" and s.adapter is None, "phone let go"
        await wait_for(ours, "claude to resume the same session in the same window")
        await wait_for(lambda: s.window["pid"] not in (None, ours.old), "phone to see it back on the laptop", 10)
        print("laptop handoff: all checks pass")
    finally:
        for p in subprocess.run(["powershell", "-NoProfile", "-Command",
                                 f"(Get-CimInstance Win32_Process -Filter 'ParentProcessId={shell.pid}').ProcessId"],
                                capture_output=True, text=True).stdout.split():
            subprocess.run(["powershell", "-NoProfile", "-Command", f"Stop-Process -Id {p} -Force"], capture_output=True)
        shell.kill()
        for a in host.adapters.values():
            a.proc.kill()
        await asyncio.sleep(0.3)


if __name__ == "__main__":
    asyncio.run(main())
