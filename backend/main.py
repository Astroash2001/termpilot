import os
import re
import sys
import json
import hmac
import hashlib
import secrets
import asyncio
import uuid
import subprocess
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from starlette.requests import HTTPConnection
from pydantic import BaseModel
from contextlib import asynccontextmanager
import uvicorn
import qrcode
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
    public_url = start_ngrok_tunnel() if os.environ.get("TERMPILOT_NGROK", "1") != "0" else None
    # The key rides in the URL fragment, which browsers never send to the server or ngrok.
    phone_url = f"{(public_url or 'http://localhost:8000')}/#key={ACCESS_KEY}"
    print("=" * 65)
    print("🔐 Scan this QR code with your phone (it contains your access key - keep it private):")
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
AUTH_FILE = os.path.join(os.path.dirname(__file__), "auth.json")
PUSH_FILE = os.path.join(os.path.dirname(__file__), "push.json")

pairing_codes = {}
registered_devices = {}
ngrok_process = None
# Wrong pairing codes since the last success; at the limit every open code is voided
failed_pair_attempts = 0
MAX_FAILED_PAIR_ATTEMPTS = 5

def load_or_create_access_key(rotate: bool = False) -> str:
    """The phone's credential. Whoever holds it can drive this PC's shell, so it is long and
    random and lives only in auth.json (gitignored) and the phone's localStorage."""
    if not rotate and os.path.exists(AUTH_FILE):
        try:
            with open(AUTH_FILE, "r") as f:
                key = json.load(f).get("access_key")
            if key:
                return key
        except Exception as e:
            print(f"Error reading auth.json, generating a new access key: {e}")
    key = secrets.token_urlsafe(32)
    with open(AUTH_FILE, "w") as f:
        json.dump({"access_key": key}, f, indent=4)
    return key

ACCESS_KEY = load_or_create_access_key()

def is_valid_access_key(key) -> bool:
    return isinstance(key, str) and hmac.compare_digest(key.encode(), ACCESS_KEY.encode())

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

def add_subscription(sub: dict):
    subs = [s for s in PUSH["subscriptions"] if s["endpoint"] != sub["endpoint"]]
    subs.append({"endpoint": sub["endpoint"], "keys": {"p256dh": sub["keys"]["p256dh"], "auth": sub["keys"]["auth"]}})
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
            webpush(sub, data, vapid_private_key=PUSH_VAPID, vapid_claims={"sub": PUSH_SUB},
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
        # Phones showing TermPilot right now; alerts go out only when there are none
        self.visible: set = set()
        # From the agent's chat messages: what an alert says and when one is due
        self.chat_names: dict = {}   # sid -> (agent name, chat title)
        self.chat_states: dict = {}  # sid -> last CHAT_STATE

    async def connect_agent(self, websocket: WebSocket):
        # Caller has already accepted and authenticated the socket
        self.agent_ws = websocket
        print("🟢 Authenticated Desktop Agent Connected!")

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
                    "rows": self.pty_rows
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
        if not alert or self.visible or not PUSH["subscriptions"]:
            return
        gone = await asyncio.to_thread(send_push, list(PUSH["subscriptions"]), alert)
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
            # Explicit IPv4 loopback: the server only listens on 127.0.0.1 by default
            ["ngrok", "http", "127.0.0.1:8000", "--host-header=rewrite"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        time.sleep(2.5)
        
        req = urllib.request.Request("http://127.0.0.1:4040/api/tunnels")
        with urllib.request.urlopen(req) as res:
            data = json.loads(res.read().decode('utf-8'))
            tunnels = data.get("tunnels", [])
            for t in tunnels:
                if t.get("proto") == "https":
                    public_url = t.get("public_url")
                    print("="*65)
                    print(f"📱 PUBLIC PHONE URL: {public_url}")
                    print("="*65 + "\n")
                    return public_url
    except Exception as e:
        print(f"⚠️ Could not auto-start ngrok tunnel: {e}")

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

# 1. Generate 6-Digit Pairing Code (only an authenticated phone may ask)
@app.post("/api/pairing/create")
def create_pairing_code(request: Request):
    auth = request.headers.get("authorization", "")
    if not is_valid_access_key(auth.removeprefix("Bearer ").strip()):
        raise HTTPException(status_code=401, detail="Unauthorized")
    now = datetime.now(timezone.utc)
    for stale in [c for c, info in pairing_codes.items() if info["used"] or now > info["expires_at"]]:
        del pairing_codes[stale]
    code = f"{secrets.randbelow(1_000_000):06d}"
    expires = now + timedelta(minutes=10)
    pairing_codes[code] = {"expires_at": expires, "used": False}
    print(f"🔑 Generated 6-Digit Pairing Code: {code}")
    return {"code": code, "expires_at": expires.isoformat()}

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
        "secret_key": secret_key
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
                await manager.broadcast_to_clients(payload)
                asyncio.create_task(manager.maybe_alert(payload))
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect_agent(websocket)

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
    if not isinstance(first, dict) or first.get("type") != "AUTH" or not is_valid_access_key(first.get("key")):
        print("⛔ Rejected phone connection with a missing or wrong access key")
        try:
            await websocket.close(code=4001, reason="Unauthorized")
        except Exception:
            pass
        return

    await websocket.send_text(json.dumps({"type": "AUTH_OK", "push_key": PUSH["public_key"]}))
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
                    add_subscription(payload["sub"])
                continue
            if kind == "VISIBLE":
                (manager.visible.add if payload.get("visible") else manager.visible.discard)(websocket)
                continue
            if not (kind in ("INPUT", "RESIZE") or (isinstance(kind, str) and kind.startswith("CHAT_"))):
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
    if "--rotate-key" in sys.argv:
        load_or_create_access_key(rotate=True)
        print("🔁 New access key saved to auth.json. Restart the server and open the new link on your phone.")
        sys.exit(0)
    # Loopback only by default: remote access goes through the HTTPS ngrok tunnel.
    # Set TERMPILOT_HOST=0.0.0.0 to allow plain-HTTP LAN access (key travels unencrypted).
    uvicorn.run("main:app", host=os.environ.get("TERMPILOT_HOST", "127.0.0.1"), port=8000, reload=True)
