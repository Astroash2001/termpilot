"""Self-check for agy_acp.py against a fake agy. Run: python test_agy_acp.py

Covers: a new chat, streamed text, a refused shell command shown as a failed tool card plus a
note, the follow-up continuing agy's own conversation, Stop ending a turn, and a chat surviving
a restart of the translator. No real agy is started and nothing is sent to Google.
"""
import json
import os
import subprocess
import sys
import tempfile
import time

FAKE_AGY = r'''
import json, sys, time
args = sys.argv[1:]
text = next(a[len("--print="):] for a in args if a.startswith("--print="))
conv = args[args.index("--conversation") + 1] if "--conversation" in args else "conv-1"
def ev(m): print(json.dumps(m), flush=True)
def step(i, **kw): ev({"event": "step_update", "step_update": {"conversation_id": conv, "step_index": i, **kw}})
ev({"event": "init", "conversation_id": conv, "init": {}})
if text == "slow":
    time.sleep(30)
step(1, state="ACTIVE", step_type="agent_response", text_delta="echo:" + text)
cmd = {"name": "run_command", "parameters": {"CommandLine": "rm -rf x"}}
step(2, state="ACTIVE", step_type="tool", tool_name="run_command", tool_info=cmd)
step(2, state="ERROR", step_type="tool", tool_name="run_command", tool_info={**cmd, "error": {"message": "user denied permission"}})
print("jetski: no output produced - a tool required the command permission")
ev({"event": "result", "result": {"conversation_id": conv, "status": "SUCCESS", "denied_actions": [{"action": "command"}]}})
'''

HERE = os.path.dirname(os.path.abspath(__file__))


class Translator:
    def __init__(self, home, fake):
        env = {**os.environ, "USERPROFILE": home, "TERMPILOT_AGY_CMD": json.dumps([sys.executable, fake])}
        self.proc = subprocess.Popen([sys.executable, os.path.join(HERE, "agy_acp.py")], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, text=True, encoding="utf-8", env=env)
        self.next_id = 0

    def call(self, method, params, timeout=20):
        """Sends a request; returns (reply, notifications seen before it)."""
        self.next_id += 1
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params}) + "\n")
        self.proc.stdin.flush()
        seen, end = [], time.time() + timeout
        while time.time() < end:
            msg = json.loads(self.proc.stdout.readline())
            if msg.get("id") == self.next_id:
                return msg, seen
            seen.append(msg["params"]["update"])
        raise AssertionError(f"no reply to {method}")

    def notify(self, method, params):
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": method, "params": params}) + "\n")
        self.proc.stdin.flush()


def main():
    home = tempfile.mkdtemp()
    fake = os.path.join(home, "fake_agy.py")
    with open(fake, "w") as f:
        f.write(FAKE_AGY)
    t = Translator(home, fake)
    assert t.call("initialize", {})[0]["result"]["agentCapabilities"]["loadSession"]
    sid = t.call("session/new", {"cwd": home})[0]["result"]["sessionId"]

    reply, seen = t.call("session/prompt", {"sessionId": sid, "prompt": [{"type": "text", "text": "hi"}]})
    assert reply["result"]["stopReason"] == "end_turn", reply
    texts = "".join(u["content"]["text"] for u in seen if u["sessionUpdate"] == "agent_message_chunk")
    assert texts.startswith("echo:hi") and "Run them yourself in the TermPilot terminal" in texts, texts
    cards = [u for u in seen if u["sessionUpdate"].startswith("tool_call")]
    assert [c["status"] for c in cards] == ["in_progress", "failed"] and cards[0]["kind"] == "execute", cards
    assert cards[0]["rawInput"]["command"] == "rm -rf x" and "denied" in json.dumps(cards[1]["content"])

    # agy cannot start (folder deleted): the chat gets an error instead of waiting forever
    gone = t.call("session/new", {"cwd": os.path.join(home, "deleted")})[0]["result"]["sessionId"]
    reply, _ = t.call("session/prompt", {"sessionId": gone, "prompt": [{"type": "text", "text": "hi"}]})
    assert "could not start" in reply["error"]["message"], reply
    reply, seen = t.call("session/prompt", {"sessionId": sid, "prompt": [{"type": "text", "text": "--dangerously-skip-permissions"}]})
    assert "echo:--dangerously-skip-permissions" in json.dumps(seen), "a message is text, never a flag"

    # The follow-up continues agy's conversation, and survives a restart of the translator
    t.proc.kill()
    t = Translator(home, fake)
    t.call("initialize", {})
    assert "error" in t.call("session/load", {"sessionId": "unknown", "cwd": home})[0]
    assert t.call("session/load", {"sessionId": sid, "cwd": home})[0]["result"] == {}
    reply, seen = t.call("session/prompt", {"sessionId": sid, "prompt": [{"type": "text", "text": "again"}]})
    assert reply["result"]["stopReason"] == "end_turn"

    # Stop: the running agy is killed and the turn ends as cancelled
    t.next_id += 1
    t.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": t.next_id, "method": "session/prompt",
                                   "params": {"sessionId": sid, "prompt": [{"type": "text", "text": "slow"}]}}) + "\n")
    t.proc.stdin.flush()
    time.sleep(1.5)
    t.notify("session/cancel", {"sessionId": sid})
    started = time.time()
    msg = json.loads(t.proc.stdout.readline())
    assert msg.get("result", {}).get("stopReason") == "cancelled" and time.time() - started < 10, msg
    t.proc.kill()
    with open(os.path.join(home, ".termpilot", "agy-sessions.json")) as f:
        assert json.load(f)[sid]["conversation"] == "conv-1", "agy's conversation id is kept for follow-ups"
    print("agy_acp: all checks pass")


if __name__ == "__main__":
    main()
