"""Files between the phone and a chat's project folder.

Downloads: the Files sheet lists the images, video, audio and documents in the chat's folder.
The phone names a file by its path inside that folder; nothing outside it, and nothing in a
hidden or dependency folder, is ever handed out.

Uploads: the relay stages a file the phone attached as ~/.termpilot/uploads/<id>/<name>.
When the message is sent, place() moves it into <project>/.termpilot/uploads and the message
tells the agent its full path on this PC.
"""
import heapq
import mimetypes
import os
import re
import shutil
from pathlib import Path

STAGE_DIR = os.path.join(os.path.expanduser("~"), ".termpilot", "uploads")
UPLOAD_ID = re.compile(r"^[A-Za-z0-9_-]{16,40}$")
MAX_DEPTH = 4

# Python's own type table, without the Windows registry (which maps .csv to Excel and worse),
# plus the types it lacks on 3.10
_types = mimetypes.MimeTypes()
for _ext, _type in ((".webp", "image/webp"), (".m4v", "video/mp4"), (".m4a", "audio/mp4"),
                    (".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
                    (".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                    (".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation")):
    _types.add_type(_type, _ext)


def file_type(name) -> str:
    """The MIME type of a file worth opening on a phone, or "" for anything else (code, pages)."""
    t = _types.guess_type(name)[0] or ""
    media = t.split("/")[0] in ("image", "video", "audio")
    return t if media or t in ("application/pdf", "application/zip", "text/csv") or "officedocument" in t else ""


def hidden(name) -> bool:
    """Never listed or served: dot and $ names, __pycache__ and the like, dependency folders."""
    return name[:1] in ".$" or name.startswith("__") or name in ("node_modules", "venv")


def list_artifacts(root, limit=60):
    """The newest viewable files under root: [{path, size, modified, kind}]."""
    found = []
    top = len(Path(root).parts)
    for folder, dirs, names in os.walk(root):
        depth = len(Path(folder).parts) - top
        dirs[:] = [d for d in dirs if not hidden(d)] if depth < MAX_DEPTH else []
        for name in names:
            t = file_type(name)
            if not t or hidden(name):
                continue
            path = os.path.join(folder, name)
            try:
                st = os.stat(path)
            except OSError:
                continue
            found.append({"path": os.path.relpath(path, root), "size": st.st_size, "modified": st.st_mtime, "kind": t.split("/")[0]})
        if len(found) > 2000:
            break  # a huge tree: what was found is enough to pick the newest from
    return heapq.nlargest(limit, found, key=lambda f: f["modified"])


def resolve_inside(root, requested):
    """The real path of the file the phone asked for, or None unless it is a viewable file
    inside root after following links, with no hidden folder on the way."""
    if not isinstance(requested, str) or not 0 < len(requested) <= 1000 or "\0" in requested:
        return None
    try:
        base = Path(root).resolve()
        target = (base / requested).resolve()
    except (OSError, ValueError, RuntimeError):
        return None
    if target == base or not target.is_relative_to(base) or any(hidden(p) for p in target.relative_to(base).parts):
        return None
    return str(target) if target.is_file() and file_type(target.name) else None


def place(ids, cwd):
    """Moves staged uploads into <cwd>/.termpilot/uploads and returns their full paths, or []
    without moving anything if any id is malformed or its file is gone."""
    if not all(isinstance(i, str) and UPLOAD_ID.match(i) for i in ids):
        return []
    try:
        staged = [(i, os.path.join(STAGE_DIR, i, os.listdir(os.path.join(STAGE_DIR, i))[0])) for i in ids]
    except (OSError, IndexError):
        return []  # nothing moved, so the phone can send the same attachments again
    folder = os.path.join(cwd, ".termpilot")
    os.makedirs(os.path.join(folder, "uploads"), exist_ok=True)
    with open(os.path.join(folder, ".gitignore"), "w") as f:
        f.write("*\n")  # keeps uploads out of whatever repo holds this folder, at any depth
    placed = []
    for upload_id, source in staged:
        name = os.path.basename(source)
        dest = os.path.join(folder, "uploads", name)
        if os.path.exists(dest):
            dest = os.path.join(folder, "uploads", f"{upload_id[:8]}-{name}")  # the id is random: no second clash
        shutil.move(source, dest)
        shutil.rmtree(os.path.dirname(source), ignore_errors=True)
        placed.append(dest)
    return placed


def attachment_note(paths):
    return "\n\n" + "\n".join(f"File sent from the phone: {p}" for p in paths) if paths else ""
