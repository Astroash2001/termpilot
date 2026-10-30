import os
import socket
import re
import sys
import json
import hmac
import hashlib
import secrets
import asyncio
import uuid
import shutil
import subprocess
import unicodedata
import time
import queue
import threading
import urllib.parse
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, Response
from starlette.requests import HTTPConnection
from pydantic import BaseModel
from contextlib import asynccontextmanager
import uvicorn
import qrcode
import qrcode.image.svg
from py_vapid import Vapid, b64urlencode
from pywebpush import webpush, WebPushException
from cryptography.hazmat.primitives import serialization

# Emoji status lines crash startup with UnicodeEncodeError when stdout is redirected
# (Windows then falls back to cp1252). Force UTF-8 and never fail on a character.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    load_registered_devices()
    # TERMPILOT_NGROK=0 skips the tunnel (local testing)
    global PUBLIC_URL
    PUBLIC_URL = start_ngrok_tunnel() if os.environ.get("TERMPILOT_NGROK", "1") != "0" else None
    phone_url = enroll_link()
    print("=" * 65)
    print("🔐 Scan this QR code with a phone to add it (one use, 10 minutes; keep it private).")
    print("   For another phone later, open http://localhost:8000/enroll on this PC.")
    qr = qrcode.QRCode(border=2)
    qr.add_data(phone_url)
    # invert=True draws dark modules as spaces, so the code scans on a dark terminal
    qr.print_ascii(invert=True)
    print(f"   Or open: {phone_url}")
    print("=" * 65 + "\n")
    yield
    # Shutdown
    global ngrok_process
    if ngrok_process:
        ngrok_process.terminate()

app = FastAPI(title="TermPilot Relay Backend", lifespan=lifespan)

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")
DEVICES_FILE = os.path.join(os.path.dirname(__file__), "devices.json")
PHONES_FILE = os.path.join(os.path.dirname(__file__), "phones.json")
PUSH_FILE = os.path.join(os.path.dirname(__file__), "push.json")

pairing_codes = {}
registered_devices = {}
ngrok_process = None
PUBLIC_URL = None
# Wrong pairing codes since the last success; at the limit every open code is voided
failed_pair_attempts = 0
MAX_FAILED_PAIR_ATTEMPTS = 5

# ── Phones ─────────────────────────────────────────────────────────────
# Every phone gets its own random key, stored here only as a hash, so one phone can be removed
# without touching the others. A phone joins with a one-time enrollment code that only this PC
# shows (the startup QR code, or /enroll opened on this PC), so a stolen phone cannot add more.
PHONE_IDLE_SECONDS = 30 * 86400   # a phone unused this long must enroll again
ENROLL_SECONDS = 600
enroll_codes = {}  # code -> expiry; single use

def load_phones() -> dict:
    try:
        with open(PHONES_FILE, "r") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}

PHONES = load_phones()

def save_phones():
    tmp = PHONES_FILE + "." + uuid.uuid4().hex
    with open(tmp, "w") as f:
        json.dump(PHONES, f, indent=4)
    os.replace(tmp, PHONES_FILE)

def new_enroll_code() -> str:
    now = time.time()
    for stale in [c for c, expires in enroll_codes.items() if expires < now]:
        del enroll_codes[stale]
    code = secrets.token_urlsafe(16)
    enroll_codes[code] = now + ENROLL_SECONDS
    return code

def enroll_link() -> str:
    # The code rides in the URL fragment, which browsers never send to the server or ngrok
    return f"{PUBLIC_URL or 'http://localhost:8000'}/#enroll={new_enroll_code()}"

def use_enroll_code(code) -> bool:
    expires = enroll_codes.pop(code, None) if isinstance(code, str) else None
    return expires is not None and expires > time.time()

def key_hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()

def add_phone(name) -> tuple:
    key, phone_id, now = secrets.token_urlsafe(32), uuid.uuid4().hex, time.time()
    PHONES[phone_id] = {"hash": key_hash(key), "name": printable(name or "Phone", 40) or "Phone", "created": now, "seen": now}
    save_phones()
    return phone_id, key

def check_phone(phone_id, key) -> bool:
    p = PHONES.get(phone_id) if isinstance(phone_id, str) else None
    if not isinstance(p, dict) or not isinstance(key, str):
        return False
    if time.time() - p.get("seen", 0) > PHONE_IDLE_SECONDS:
        del PHONES[phone_id]
        save_phones()
        return False
    if not hmac.compare_digest(p.get("hash", ""), key_hash(key)):
        return False
    p["seen"] = time.time()
    save_phones()
    return True

def phones_message(current: str) -> dict:
    rows = [{"id": pid, "name": p.get("name", "Phone"), "created": p.get("created"), "seen": p.get("seen"), "current": pid == current}
            for pid, p in PHONES.items()]
    return {"type": "DEVICES", "devices": sorted(rows, key=lambda r: -(r["seen"] or 0))}

# Shared with the desktop agent through the user's profile, which other Windows accounts can't
# read. At pairing the relay MACs the agent's nonce with it, so the agent can tell this relay
# from a process another account parked on port 8000 while the relay was down.
RELAY_KEY_FILE = os.path.join(os.path.expanduser("~"), ".termpilot", "relay.key")

def load_or_create_relay_key() -> bytes:
    try:
        with open(RELAY_KEY_FILE, "r") as f:
            key = f.read().strip()
        if len(key) >= 64:
            return key.encode()
    except OSError:
        pass
    os.makedirs(os.path.dirname(RELAY_KEY_FILE), exist_ok=True)
    key = secrets.token_hex(32)
    with open(RELAY_KEY_FILE, "w") as f:
        f.write(key)
    return key.encode()

RELAY_KEY = load_or_create_relay_key()

def pairing_proof(nonce: str, device_id: str, secret_key: str) -> str:
    """Must match desktop-agent/agent.py."""
    return hmac.new(RELAY_KEY, f"pair:{nonce}:{device_id}:{secret_key}".encode(), hashlib.sha256).hexdigest()

def device_mac(secret_key: str, role: str, nonce: str) -> str:
    """Proof of a device secret over the other side's fresh nonce. Must match desktop-agent/agent.py."""
    return hmac.new(secret_key.encode(), f"{role}:{nonce}".encode(), hashlib.sha256).hexdigest()

def printable(value, limit: int = 64) -> str:
    """A request value made safe for the console: no newlines or escape sequences to forge lines with."""
    return "".join(c for c in str(value)[:limit] if c.isprintable())

def is_direct_local(conn: HTTPConnection) -> bool:
    """True only for a process on this PC talking to us directly (the desktop agent).

    ngrok also connects from loopback, but it stamps every forwarded request with
    X-Forwarded-For, and uvicorn rewrites client.host from that header. Tunnelled
    traffic therefore fails one check or the other.
    """
    host = conn.client.host if conn.client else None
    return host in ("127.0.0.1", "::1") and "x-forwarded-for" not in conn.headers

def load_registered_devices():
    global registered_devices
    if os.path.exists(DEVICES_FILE):
        try:
            with open(DEVICES_FILE, "r") as f:
                registered_devices = json.load(f)
                print(f"💾 Loaded {len(registered_devices)} registered device(s) from devices.json")
        except Exception as e:
            print(f"Error loading devices.json: {e}")

# Immediately populate registered devices on startup
load_registered_devices()

def save_registered_devices():
    with open(DEVICES_FILE, "w") as f:
        json.dump(registered_devices, f, indent=4)

class PairingVerifyRequest(BaseModel):
    code: str
    device_name: str = "Windows-PC"
    nonce: str = ""  # the agent's fresh challenge, answered with pairing_proof

# ── Alerts (Web Push) ──────────────────────────────────────────────────────
# The relay signs pushes with its own VAPID key and sends them through the phone browser's
# push service (Google, Apple, Mozilla). The payload is end-to-end encrypted to the phone.
# VAPID contact claim. Apple requires one, and py_vapid accepts only mailto: or a bare https origin
PUSH_SUB = "https://github.com"
MAX_PUSH_SUBSCRIPTIONS = 10

def load_push() -> dict:
    """VAPID key pair and the phones' push subscriptions. The private key lets anyone send
    alerts as this relay, so it lives only in push.json (gitignored)."""
    if os.path.exists(PUSH_FILE):
        try:
            with open(PUSH_FILE, "r") as f:
                d = json.load(f)
            if d.get("private_key") and d.get("public_key"):
                d.setdefault("subscriptions", [])
                return d
        except Exception as e:
            print(f"Error reading push.json, generating a new alert key: {e}")
    v = Vapid()
    v.generate_keys()
    raw = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    d = {"private_key": v.private_pem().decode(), "public_key": b64urlencode(raw), "subscriptions": []}
    save_push(d)
    return d

def save_push(d: dict):
    with open(PUSH_FILE, "w") as f:
        json.dump(d, f, indent=4)

PUSH = load_push()
PUSH_VAPID = Vapid.from_pem(PUSH["private_key"].encode())

def valid_subscription(sub) -> bool:
    """A PushSubscription.toJSON() from the phone. The relay POSTs to its endpoint, so only https."""
    if not isinstance(sub, dict):
        return False
    endpoint, keys = sub.get("endpoint"), sub.get("keys")
    return (isinstance(endpoint, str) and endpoint.startswith("https://") and len(endpoint) < 2000
            and isinstance(keys, dict)
            and all(isinstance(keys.get(k), str) and 0 < len(keys[k]) < 200 for k in ("p256dh", "auth")))

def add_subscription(sub: dict, phone_id: str):
    subs = [s for s in PUSH["subscriptions"] if s["endpoint"] != sub["endpoint"]]
    # The phone it belongs to: removing that phone stops its alerts too
    subs.append({"endpoint": sub["endpoint"], "keys": {"p256dh": sub["keys"]["p256dh"], "auth": sub["keys"]["auth"]}, "phone": phone_id})
    PUSH["subscriptions"] = subs[-MAX_PUSH_SUBSCRIPTIONS:]
    save_push(PUSH)

def send_push(subs: list, alert: dict) -> list:
    """Blocking: posts one alert to every subscription. Returns the endpoints the push service
    says are gone (the phone unsubscribed or cleared site data)."""
    gone = []
    data = json.dumps(alert)
    for sub in subs:
        try:
            # webpush fills aud/exp into the claims dict, so each push service gets a fresh one
            webpush({"endpoint": sub["endpoint"], "keys": sub["keys"]}, data, vapid_private_key=PUSH_VAPID, vapid_claims={"sub": PUSH_SUB},
                    ttl=3600, timeout=10, headers={"Urgency": "high"})
        except WebPushException as e:
            if e.response is not None and e.response.status_code in (404, 410):
                gone.append(sub["endpoint"])
            else:
                print(f"⚠️ Alert not sent: {printable(e, 200)}")
        except Exception as e:
            print(f"⚠️ Alert not sent: {printable(e, 200)}")
    return gone

ALT_SCREEN_SWITCH = re.compile(r"\x1b\[\?(?:1049|1047|47)([hl])")

class ConnectionManager:
    # Maximum bytes of terminal output to keep in the scrollback buffer
    MAX_BUFFER_BYTES = 100_000

    def __init__(self):
        self.agent_ws: WebSocket = None
        self.client_ws: list[WebSocket] = []
        # Ring buffer of RAW terminal output for replay on client reconnect
        self._output_buffer: list[str] = []
        self._buffer_size: int = 0
        # Full-screen apps (Claude Code, vim) switch to the alternate screen once, at start.
        # That switch soon falls out of the ring buffer, so it is tracked here and replayed
        # first; without it a reconnecting phone draws their frames on its normal screen.
        self._alt_screen: bool = False
        self.pty_cols: int = None
        self.pty_rows: int = None
        self.pty_owner: str = None  # "phone" or "host": who the phone slider shows in control
        # Phones showing TermPilot right now; alerts go out only when there are none
        self.visible: set = set()
        self.phone_of: dict = {}  # client socket -> phone id, to cut off a removed phone
        # From the agent's chat messages: what an alert says and when one is due
        self.chat_names: dict = {}   # sid -> (agent name, chat title)
        self.chat_states: dict = {}  # sid -> last CHAT_STATE

    async def connect_agent(self, websocket: WebSocket):
        # Caller has already accepted and authenticated the socket
        self.agent_ws = websocket
        print("🟢 Authenticated Desktop Agent Connected!")
        # Phones already connected still show "PC offline" and an empty chat list until told
        await self.broadcast_to_clients({"type": "AGENT_ONLINE"})

    def disconnect_agent(self, websocket: WebSocket):
        # A reconnecting agent may already own the slot; only clear our own
        if self.agent_ws is websocket:
            self.agent_ws = None
            print("🔴 Desktop Agent Disconnected.")

    async def connect_client(self, websocket: WebSocket):
        # Caller has already accepted and authenticated the socket
        self.client_ws.append(websocket)
        # Send current PTY dimensions if known
        if self.pty_cols and self.pty_rows:
            try:
                await websocket.send_text(json.dumps({
                    "type": "PTY_SIZE",
                    "cols": self.pty_cols,
                    "rows": self.pty_rows,
                    "owner": self.pty_owner,
                }))
            except Exception:
                pass
        # Replay buffered terminal output so the client sees full history
        if self._output_buffer:
            try:
                replay = ("\x1b[?1049h" if self._alt_screen else "") + "".join(self._output_buffer)
                await websocket.send_text(json.dumps({
                    "type": "RAW",
                    "data": replay
                }))
            except Exception:
                pass

    def disconnect_client(self, websocket: WebSocket):
        if websocket in self.client_ws:
            self.client_ws.remove(websocket)
        self.visible.discard(websocket)
        self.phone_of.pop(websocket, None)

    def alert_for(self, message: dict):
        """The alert a chat message from the agent calls for, or None: an agent asks to run a
        tool, finishes a turn, or stops on an error."""
        kind, sid = message.get("type"), message.get("sid")
        if kind == "CHAT_SESSIONS":
            agents = message.get("agents") or {}
            for s in message.get("sessions") or []:
                if isinstance(s, dict) and isinstance(s.get("sid"), str):
                    self.chat_names[s["sid"]] = (agents.get(s.get("agent"), "Agent"), s.get("title") or "")
            return None
        if not isinstance(sid, str):
            return None
        agent, title = self.chat_names.get(sid, ("Agent", ""))
        alert = {"tag": sid, "url": f"/#chat/{sid}"}
        if kind == "CHAT_PERMISSION":
            tool = message.get("toolCall") or {}
            return {**alert, "title": f"{agent} needs your OK", "body": str(tool.get("title") or title)[:200]}
        if kind == "CHAT_STATE":
            state, before = message.get("state"), self.chat_states.get(sid)
            self.chat_states[sid] = state
            if state == "idle" and before in ("thinking", "needs_you"):
                return {**alert, "title": f"{agent} is done", "body": title[:200]}
            if state == "error" and before != "error":
                return {**alert, "title": f"{agent} stopped", "body": str(message.get("reason") or title)[:200]}
        return None

    async def maybe_alert(self, message: dict):
        alert = self.alert_for(message)
        # Only phones that may still connect get alerts: a revoked or expired phone's
        # subscription would otherwise keep receiving what the agents are doing
        subs = [s for s in PUSH["subscriptions"] if s.get("phone") in PHONES]
        if not alert or self.visible or not subs:
            return
        gone = await asyncio.to_thread(send_push, subs, alert)
        if gone:
            PUSH["subscriptions"] = [s for s in PUSH["subscriptions"] if s["endpoint"] not in gone]
            save_push(PUSH)

    def _buffer_output(self, data: str):
        """Append terminal output to the scrollback buffer, trimming old data if over cap."""
        switches = ALT_SCREEN_SWITCH.findall(data)
        if switches:
            self._alt_screen = switches[-1] == "h"
        self._output_buffer.append(data)
        self._buffer_size += len(data)
        while self._buffer_size > self.MAX_BUFFER_BYTES and self._output_buffer:
            removed = self._output_buffer.pop(0)
            self._buffer_size -= len(removed)

    async def send_to_agent(self, message: dict):
        if self.agent_ws:
            await self.agent_ws.send_text(json.dumps(message))
            return True
        return False

    async def broadcast_to_clients(self, message: dict):
        # Cache PTY dimensions when agent reports them
        if message.get("type") == "PTY_SIZE":
            self.pty_cols = message.get("cols")
            self.pty_rows = message.get("rows")
            self.pty_owner = message.get("owner")
        # Buffer RAW terminal output for replay on future client connects
        elif message.get("type") == "RAW":
            self._buffer_output(message.get("data", ""))
        for ws in self.client_ws:
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                pass

manager = ConnectionManager()

def start_ngrok_tunnel():
    global ngrok_process
    print("\n🚀 Starting ngrok tunnel automatically...")
    try:
        ngrok_process = subprocess.Popen(
            # Explicit IPv4 loopback: the server only listens on 127.0.0.1 by default.
            # --inspect=false: ngrok's inspector on port 4040 would keep every request, headers
            # included, where any local account can read it.
            # The URL is read from this child's own log, never from whatever answers on 4040:
            # another account could squat that port and hand back its own site for the QR code.
            ["ngrok", "http", "127.0.0.1:8000", "--host-header=rewrite", "--inspect=false",
             "--log=stdout", "--log-format=json"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL
        )
        found = queue.Queue()

        def read_log():
            # Keeps draining after the URL, or ngrok would block on a full pipe
            for line in ngrok_process.stdout:
                url = tunnel_url_from_log(line)
                if url:
                    found.put(url)

        threading.Thread(target=read_log, daemon=True).start()
        try:
            public_url = found.get(timeout=20)
        except queue.Empty:
            print("⚠️ ngrok did not report an https ngrok tunnel; only the local link is shown.")
            return None
        print("="*65)
        print(f"📱 PUBLIC PHONE URL: {public_url}")
        print("="*65 + "\n")
        return public_url
    except Exception as e:
        print(f"⚠️ Could not auto-start ngrok tunnel: {e}")

NGROK_HOST_SUFFIXES = (".ngrok-free.app", ".ngrok-free.dev", ".ngrok.app", ".ngrok.dev", ".ngrok.io")

def tunnel_url_from_log(line) -> str:
    """The public URL in one of our ngrok child's JSON log lines, or None. The access key is
    appended to it for the QR code, so only https on an ngrok host passes."""
    try:
        record = json.loads(line)
    except ValueError:
        return None
    if not isinstance(record, dict) or record.get("msg") != "started tunnel" or not isinstance(record.get("url"), str):
        return None
    parts = urllib.parse.urlsplit(record["url"])
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or parts.port or parts.username or not host.endswith(NGROK_HOST_SUFFIXES):
        return None
    return f"https://{host}"

# Browser hardening for every HTTP response. DENY framing so another site can't overlay
# the UI and trick taps into shell commands. 'unsafe-inline' scripts are still needed
# for the onclick= attributes in index.html.
SECURITY_HEADERS = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "img-src 'self' data:; "
        "connect-src 'self' ws: wss:; "
        "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    ),
}

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    return response

# Static File Routes (no-cache to prevent stale mobile browser caching)
NO_CACHE_HEADERS = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache"}

@app.get("/")
def serve_web_ui():
    path = os.path.join(WEB_DIR, "index.html")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    return Response(content=content, media_type="text/html", headers=NO_CACHE_HEADERS)

@app.get("/styles.css")
def serve_css():
    path = os.path.join(WEB_DIR, "styles.css")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    return Response(content=content, media_type="text/css", headers=NO_CACHE_HEADERS)

@app.get("/app.js")
@app.get("/chat.js")
@app.get("/sw.js")
def serve_js(request: Request):
    path = os.path.join(WEB_DIR, request.url.path.lstrip("/"))
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    return Response(content=content, media_type="application/javascript", headers=NO_CACHE_HEADERS)

@app.get("/manifest.json")
def serve_manifest():
    with open(os.path.join(WEB_DIR, "manifest.json"), "r", encoding="utf-8") as f:
        content = f.read()
    return Response(content=content, media_type="application/manifest+json", headers=NO_CACHE_HEADERS)

FONTS_DIR = os.path.join(WEB_DIR, "fonts")

@app.get("/fonts/{name}")
def serve_font(name: str):
    # Exact match against the files on disk, so a crafted name can't walk out of the folder
    if not name.endswith(".woff2") or name not in os.listdir(FONTS_DIR):
        raise HTTPException(status_code=404)
    with open(os.path.join(FONTS_DIR, name), "rb") as f:
        content = f.read()
    return Response(content=content, media_type="font/woff2", headers={"Cache-Control": "public, max-age=31536000, immutable"})

@app.get("/favicon.svg")
@app.get("/favicon.ico")
def serve_favicon():
    path = os.path.join(WEB_DIR, "favicon.svg")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    return Response(content=content, media_type="image/svg+xml", headers=NO_CACHE_HEADERS)

def web_version() -> str:
    """A hash of the web app's files. An open page compares it on every reconnect and offers
    a reload when the PC serves a newer app."""
    h = hashlib.sha1()
    for name in sorted(os.listdir(WEB_DIR)):
        path = os.path.join(WEB_DIR, name)
        if os.path.isfile(path):
            with open(path, "rb") as f:
                h.update(name.encode() + b"\0" + f.read())
    return h.hexdigest()[:12]

@app.get("/enroll")
def enroll_page(request: Request):
    """A QR code that adds one more phone. Only for a browser on this PC: the Host check stops a
    web page from reading it through a DNS name pointed at 127.0.0.1."""
    if not is_direct_local(request) or request.headers.get("host") not in ("localhost:8000", "127.0.0.1:8000"):
        raise HTTPException(status_code=403, detail="Open this on the PC that runs TermPilot")
    link = enroll_link()
    svg = qrcode.make(link, image_factory=qrcode.image.svg.SvgPathImage, border=2).to_string(encoding="unicode")
    page = ("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>Add a phone</title>"
            "<body style='font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px;text-align:center'>"
            "<h1>Add a phone to TermPilot</h1><p>Scan this with the phone's camera within 10 minutes. It works once.</p>"
            f"<div style='width:280px;margin:auto'>{svg}</div><p>Reload this page for another phone.</p></body>")
    return HTMLResponse(page, headers=NO_CACHE_HEADERS)

# ── Files between the phone and a chat's folder (see desktop-agent/files.py) ──
# Uploads: the phone takes a one-use ticket over its authenticated socket, then POSTs the bytes
# here. They are staged where the PC agent moves them into the project when the message is sent.
STAGE_DIR = os.path.join(os.path.expanduser("~"), ".termpilot", "uploads")  # must match desktop-agent/files.py
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
upload_tickets = {}  # ticket -> expiry
# Downloads: the PC agent grants one file under a random token for 10 minutes (FILE_GRANT)
file_grants = {}     # token -> {"file", "mime", "expires"}
# Names Windows keeps for devices: a file called nul.txt cannot be created
WINDOWS_DEVICES = {"CON", "PRN", "AUX", "NUL"} | {f"{port}{n}" for port in ("COM", "LPT") for n in range(10)}

def safe_file_name(name) -> str:
    """The phone's file name, safe to create here: last path part only, letters, digits and a
    few marks kept, at most about 120 characters with the extension kept, never a device name."""
    last = unicodedata.normalize("NFC", str(name or "")).replace("\\", "/").split("/")[-1]
    stem, ext = os.path.splitext("".join(c if c.isalnum() or c in " ._-()" else "_" for c in last).strip(" ."))
    if stem.split(".")[0].upper() in WINDOWS_DEVICES:
        stem = "_" + stem
    return (stem[:100] + ext[:20]) or "file"

def new_upload_ticket() -> str:
    now = time.time()
    for stale in [t for t, expires in upload_tickets.items() if expires < now]:
        del upload_tickets[stale]
    ticket = secrets.token_urlsafe(24)
    upload_tickets[ticket] = now + 120
    return ticket

def sweep_uploads():
    """Staged files never sent with a message go after a day."""
    try:
        names = os.listdir(STAGE_DIR)
    except OSError:
        return
    for name in names:
        path = os.path.join(STAGE_DIR, name)
        try:
            if time.time() - os.path.getmtime(path) > 86400:
                shutil.rmtree(path, ignore_errors=True)
        except OSError:
            pass

@app.post("/api/upload")
async def upload(request: Request):
    # Ticket and name ride in headers, so neither lands in an access log line
    expires = upload_tickets.pop(request.headers.get("x-upload-ticket", ""), None)
    if not expires or expires < time.time():
        raise HTTPException(status_code=403, detail="Upload not allowed. Try again.")
    if int(request.headers.get("content-length") or 0) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Files can be up to 100 MB")
    sweep_uploads()
    upload_id = secrets.token_urlsafe(18)
    folder = os.path.join(STAGE_DIR, upload_id)
    os.makedirs(folder)
    path = os.path.join(folder, safe_file_name(urllib.parse.unquote(request.headers.get("x-file-name", ""))))
    size = 0
    try:
        with open(path, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Files can be up to 100 MB")
                f.write(chunk)
        if not size:
            raise HTTPException(status_code=400, detail="That file is empty")
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    return {"id": upload_id, "name": os.path.basename(path), "size": size}

def grant_file(msg: dict):
    """A FILE_GRANT from the PC agent, turned into the link the phone gets, or None."""
    token, path = msg.get("token"), msg.get("file")
    if not (isinstance(token, str) and len(token) >= 32 and isinstance(path, str) and os.path.isfile(path)):
        return None
    now = time.time()
    for stale in [t for t, g in file_grants.items() if g["expires"] < now]:
        del file_grants[stale]
    file_grants[token] = {"file": path, "mime": str(msg.get("mime") or "application/octet-stream"), "expires": now + 600}
    return {"type": "CHAT_FILE_URL", "sid": msg.get("sid"), "path": msg.get("path"), "url": f"/api/file/{token}"}

@app.get("/api/file/{token}")
def serve_file(token: str, download: int = 0):
    g = file_grants.get(token)
    if not g or g["expires"] < time.time() or not os.path.isfile(g["file"]):
        raise HTTPException(status_code=404)
    headers = {"Cache-Control": "private, no-store"}
    if g["mime"] == "image/svg+xml":
        headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"  # shown, never run
    # FileResponse answers Range requests, so a phone can seek in a video
    return FileResponse(g["file"], media_type=g["mime"], filename=os.path.basename(g["file"]), headers=headers,
                        content_disposition_type="attachment" if download else "inline")

# 1. Generate 6-Digit Pairing Code. Only an authenticated phone may ask, and it asks on the
# WebSocket (AUTH with purpose "pair"): an HTTP request would carry the access key in a header.
def new_pairing_code() -> dict:
    now = datetime.now(timezone.utc)
    for stale in [c for c, info in pairing_codes.items() if info["used"] or now > info["expires_at"]]:
        del pairing_codes[stale]
    code = f"{secrets.randbelow(1_000_000):06d}"
    expires = now + timedelta(minutes=10)
    pairing_codes[code] = {"expires_at": expires, "used": False}
    print(f"🔑 Generated 6-Digit Pairing Code: {code}")
    return {"type": "PAIR_CODE", "code": code, "expires_at": expires.isoformat()}

# 2. Verify 6-Digit Pairing Code (Called by Desktop Agent)
@app.post("/api/pairing/verify")
def verify_pairing(req: PairingVerifyRequest, request: Request):
    global failed_pair_attempts
    # The agent always runs on this PC; refusing tunnelled callers stops remote code guessing
    if not is_direct_local(request):
        raise HTTPException(status_code=403, detail="Pairing is only allowed from this PC")
    code_info = pairing_codes.get(req.code)
    if not code_info:
        failed_pair_attempts += 1
        if failed_pair_attempts >= MAX_FAILED_PAIR_ATTEMPTS:
            pairing_codes.clear()
            failed_pair_attempts = 0
            print("⛔ Too many wrong pairing codes - all open codes voided.")
        raise HTTPException(status_code=404, detail="Invalid pairing code")
    if code_info["used"]:
        raise HTTPException(status_code=400, detail="Pairing code already used")
    if datetime.now(timezone.utc) > code_info["expires_at"]:
        raise HTTPException(status_code=400, detail="Pairing code expired")
    if len(req.nonce) < 32 or len(req.nonce) > 128:
        raise HTTPException(status_code=400, detail="Update the desktop agent, then pair again")

    device_id = str(uuid.uuid4())
    secret_key = str(uuid.uuid4())
    registered_devices[device_id] = {
        "secret_key": secret_key,
        "name": req.device_name
    }
    save_registered_devices()
    code_info["used"] = True
    failed_pair_attempts = 0
    print(f"✅ Device '{printable(req.device_name)}' paired successfully! Device ID: {device_id}")

    return {
        "status": "SUCCESS",
        "device_id": device_id,
        "secret_key": secret_key,
        "proof": pairing_proof(req.nonce, device_id, secret_key)
    }

# 3. Authenticated Agent WebSocket Endpoint
@app.websocket("/ws/agent")
async def websocket_agent(websocket: WebSocket):
    await websocket.accept()
    # Mutual challenge-response: each side MACs the other's fresh nonce with the device
    # secret, so the secret never crosses the socket (or lands in a URL or log), and the
    # agent can tell this relay from a process squatting the port.
    authorized = False
    stored_key = None
    agent_nonce = None
    if is_direct_local(websocket):  # the agent never comes through the tunnel
        load_registered_devices()
        relay_nonce = secrets.token_hex(16)
        try:
            await websocket.send_text(json.dumps({"type": "CHALLENGE", "nonce": relay_nonce}))
            first = json.loads(await asyncio.wait_for(websocket.receive_text(), timeout=10))
        except Exception:
            first = None
        if isinstance(first, dict) and first.get("type") == "AUTH":
            device_info = registered_devices.get(first.get("device_id")) if isinstance(first.get("device_id"), str) else None
            stored_key = device_info.get("secret_key") if isinstance(device_info, dict) else None
            agent_nonce = first.get("nonce")
            mac = first.get("mac")
            authorized = (
                isinstance(stored_key, str) and isinstance(mac, str)
                and isinstance(agent_nonce, str) and len(agent_nonce) >= 32
                and hmac.compare_digest(mac, device_mac(stored_key, "agent", relay_nonce))
            )
    if not authorized:
        print("⛔ Unauthorized agent connection attempt")
        try:
            await websocket.close(code=4001, reason="Unauthorized")
        except Exception:
            pass
        return
    await websocket.send_text(json.dumps({"type": "AUTH_OK", "mac": device_mac(stored_key, "relay", agent_nonce)}))

    await manager.connect_agent(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
            except ValueError:
                continue
            if isinstance(payload, dict):
                if payload.get("type") == "FILE_GRANT":
                    payload = grant_file(payload)
                    if not payload:
                        continue
                await manager.broadcast_to_clients(payload)
                asyncio.create_task(manager.maybe_alert(payload))
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect_agent(websocket)

async def remove_phone(phone_id):
    """Forgets a phone: its key stops working, its open sockets close and its alerts stop."""
    if not isinstance(phone_id, str) or PHONES.pop(phone_id, None) is None:
        return
    save_phones()
    # Untagged ones predate per-phone keys and may be this phone's; live phones re-subscribe on connect
    PUSH["subscriptions"] = [s for s in PUSH["subscriptions"] if s.get("phone") not in (phone_id, None)]
    save_push(PUSH)
    for ws, owner in list(manager.phone_of.items()):
        if owner == phone_id:
            try:
                await ws.close(code=4001, reason="Removed")
            except Exception:
                pass
    print("🚫 Removed a phone")

# 4. Mobile / Web Client Connection Endpoint
@app.websocket("/ws/client")
async def websocket_client(websocket: WebSocket):
    await websocket.accept()
    # Browsers can't set headers on a WebSocket, and a key in the URL would land in ngrok's
    # request log, so the phone proves itself with its first message: {type: AUTH, key}.
    # Nothing (scrollback included) is sent and no input is relayed until that passes.
    try:
        first = json.loads(await asyncio.wait_for(websocket.receive_text(), timeout=10))
    except Exception:
        first = None
    phone = None
    if isinstance(first, dict) and first.get("type") == "AUTH":
        if use_enroll_code(first.get("enroll")):
            phone, key = add_phone(first.get("name"))
            print(f"📱 Added phone '{PHONES[phone]['name']}'")
            await websocket.send_text(json.dumps({"type": "DEVICE_KEY", "id": phone, "key": key}))
        elif check_phone(first.get("device"), first.get("key")):
            phone = first["device"]
    if not phone:
        print("⛔ Rejected phone connection with a missing, wrong or removed key")
        try:
            await websocket.close(code=4001, reason="Unauthorized")
        except Exception:
            pass
        return

    if first.get("purpose") == "pair":
        await websocket.send_text(json.dumps(new_pairing_code()))
        await websocket.close()
        return
    await websocket.send_text(json.dumps({"type": "AUTH_OK", "push_key": PUSH["public_key"], "version": web_version()}))
    manager.phone_of[websocket] = phone
    await manager.connect_client(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
            except ValueError:
                continue
            if not isinstance(payload, dict):
                continue
            # Only relay known message types. Content is deliberately not logged:
            # keystrokes can include passwords.
            kind = payload.get('type')
            # Relay-only messages: alert subscription and whether this phone shows TermPilot
            if kind == "PUSH_SUBSCRIBE":
                if valid_subscription(payload.get("sub")):
                    add_subscription(payload["sub"], phone)
                continue
            if kind == "UPLOAD_TICKET":
                await websocket.send_text(json.dumps({"type": "UPLOAD_TICKET", "rid": payload.get("rid"), "ticket": new_upload_ticket()}))
                continue
            if kind == "DEVICES":
                await websocket.send_text(json.dumps(phones_message(phone)))
                continue
            if kind == "DEVICE_REVOKE":
                await remove_phone(payload.get("id"))
                if payload.get("id") == phone:
                    break  # this phone removed itself: its socket is closed now
                await websocket.send_text(json.dumps(phones_message(phone)))
                continue
            if kind == "VISIBLE":
                (manager.visible.add if payload.get("visible") else manager.visible.discard)(websocket)
                if payload.get("visible"):
                    # Back on screen: a page left open learns of an updated web app without reconnecting
                    await websocket.send_text(json.dumps({"type": "VERSION", "version": web_version()}))
                continue
            if not (kind in ("INPUT", "RESIZE", "CONTROL") or (isinstance(kind, str) and kind.startswith("CHAT_"))):
                continue
            # The agent's socket closes on messages over 1 MiB; one oversized paste must not cut it off
            if len(data) > 512_000:
                continue

            success = await manager.send_to_agent(payload)
            if not success:
                await websocket.send_text(json.dumps({
                    "type": "STDERR",
                    "data": "ERROR: Desktop Agent is OFFLINE or UNPAIRED!\n"
                }))
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect_client(websocket)
        # The PTY may be sized for the phone that just left; let the PC have it back
        if not manager.client_ws:
            try:
                await manager.send_to_agent({"type": "PHONES_GONE"})
            except Exception:
                pass

if __name__ == "__main__":
    if "--remove-all-phones" in sys.argv:
        # A running relay holds every phone in memory and writes them all back at the next
        # login, which would quietly undo this. So it only runs while the relay is down.
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", 8000)) == 0:
                print("TermPilot is running. Stop it first (Stop TermPilot), then run this again.")
                sys.exit(1)
        PHONES.clear()
        save_phones()
        print("🚫 Every phone removed. Restart the server and scan the new QR code.")
        sys.exit(0)
    # Loopback only by default: remote access goes through the HTTPS ngrok tunnel.
    # Set TERMPILOT_HOST=0.0.0.0 to allow plain-HTTP LAN access (key travels unencrypted).
    uvicorn.run("main:app", host=os.environ.get("TERMPILOT_HOST", "127.0.0.1"), port=8000, reload=True,
                # Open phone sockets otherwise hold an auto-reload forever: the old server never exits
                timeout_graceful_shutdown=3)
