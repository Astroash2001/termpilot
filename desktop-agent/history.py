"""Past agent sessions on this PC, and whether each agent can run at all.

History: Claude Code keeps every session as ~/.claude/projects/<folder>/<id>.jsonl, and Codex as
~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl with titles in ~/.codex/session_index.jsonl.
The phone lists them and can reopen any one as a chat (ACP session/load replays its history).

Health: cheap file and environment checks only. Nothing is started and no tokens are spent.
"""
import glob
import json
import os
import re
import shutil

HOME = os.path.expanduser("~")
SESSION_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def _first_lines(path, n):
    out = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    continue
                if len(out) >= n:
                    break
    except OSError:
        pass
    return out


def claude_sessions(first_prompt, limit):
    """[{agent, sid, cwd, title, updated}] for the newest Claude Code sessions."""
    files = glob.glob(os.path.join(HOME, ".claude", "projects", "*", "*.jsonl"))
    files = sorted(files, key=lambda p: -os.path.getmtime(p))[:limit]
    out = []
    for path in files:
        sid = os.path.splitext(os.path.basename(path))[0]
        if not SESSION_ID.match(sid):
            continue
        # The folder is on the first records that carry one
        cwd = next((d["cwd"] for d in _first_lines(path, 20) if isinstance(d.get("cwd"), str)), None)
        title = first_prompt(sid)
        if cwd and title:  # no message yet: nothing to reopen
            out.append({"agent": "claude", "sid": sid, "cwd": cwd, "title": title, "updated": os.path.getmtime(path)})
    return out


def codex_sessions(limit):
    names = {}
    for d in _first_lines(os.path.join(HOME, ".codex", "session_index.jsonl"), 100_000):
        if isinstance(d.get("id"), str):
            names[d["id"]] = d.get("thread_name") or ""
    files = glob.glob(os.path.join(HOME, ".codex", "sessions", "*", "*", "*", "rollout-*.jsonl"))
    files = sorted(files, key=lambda p: -os.path.getmtime(p))[:limit]
    out = []
    for path in files:
        meta = next(iter(_first_lines(path, 1)), {})
        p = meta.get("payload") or {}
        sid, cwd = p.get("id"), p.get("cwd")
        if meta.get("type") != "session_meta" or not isinstance(sid, str) or not SESSION_ID.match(sid) or not isinstance(cwd, str):
            continue
        out.append({"agent": "codex", "sid": sid, "cwd": cwd, "title": " ".join(str(names.get(sid, "")).split())[:80] or "Codex session",
                    "updated": os.path.getmtime(path)})
    return out


def past_sessions(agents, first_prompt, limit=40):
    """Newest past sessions of the installed agents, newest first."""
    found = []
    if "claude" in agents:
        found += claude_sessions(first_prompt, limit)
    if "codex" in agents:
        found += codex_sessions(limit)
    return sorted(found, key=lambda s: -s["updated"])[:limit]


def _env(*names):
    return any(os.environ.get(n) for n in names)


def agent_problem(agent_id) -> str:
    """Why this agent cannot run a chat right now, or "" if it looks ready."""
    if agent_id == "agy":
        return ""  # agy keeps its own login; a missing one shows as an error in the chat
    if not shutil.which("node"):
        return "Node.js is not installed"
    if agent_id == "claude":
        ok = os.path.exists(os.path.join(HOME, ".claude", ".credentials.json")) or _env("ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN")
        return "" if ok else "Not signed in. Run claude on the PC and log in."
    if agent_id == "codex":
        ok = os.path.exists(os.path.join(HOME, ".codex", "auth.json")) or _env("OPENAI_API_KEY", "CODEX_API_KEY")
        return "" if ok else "Not signed in. Run codex login on the PC."
    return ""
