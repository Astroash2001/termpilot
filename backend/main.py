import os
import json
import random
import string
import uuid
import subprocess
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from contextlib import asynccontextmanager
import uvicorn

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    load_registered_devices()
    start_ngrok_tunnel()
    yield
    # Shutdown
    global ngrok_process
    if ngrok_process:
        ngrok_process.terminate()

app = FastAPI(title="TermPilot Relay Backend", lifespan=lifespan)

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")
DEVICES_FILE = os.path.join(os.path.dirname(__file__), "devices.json")

pairing_codes = {}
registered_devices = {}
ngrok_process = None

def load_registered_devices():
    global registered_devices
    if os.path.exists(DEVICES_FILE):
        try:
            with open(DEVICES_FILE, "r") as f:
                registered_devices = json.load(f)
                print(f"💾 Loaded {len(registered_devices)} registered device(s) from devices.json")
        except Exception as e:
            print(f"Error loading devices.json: {e}")

def save_registered_devices():
    with open(DEVICES_FILE, "w") as f:
        json.dump(registered_devices, f, indent=4)

class PairingVerifyRequest(BaseModel):
    code: str
    device_name: str = "Windows-PC"

class ConnectionManager:
    def __init__(self):
        self.agent_ws: WebSocket = None
        self.client_ws: list[WebSocket] = []

    async def connect_agent(self, websocket: WebSocket):
        await websocket.accept()
        self.agent_ws = websocket
        print("🟢 Authenticated Desktop Agent Connected!")

    def disconnect_agent(self):
        self.agent_ws = None
        print("🔴 Desktop Agent Disconnected.")

    async def connect_client(self, websocket: WebSocket):
        await websocket.accept()
        self.client_ws.append(websocket)

    def disconnect_client(self, websocket: WebSocket):
        if websocket in self.client_ws:
            self.client_ws.remove(websocket)

    async def send_to_agent(self, message: dict):
        if self.agent_ws:
            await self.agent_ws.send_text(json.dumps(message))
            return True
        return False

    async def broadcast_to_clients(self, message: dict):
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
            ["ngrok", "http", "8000", "--host-header=rewrite"],
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
def serve_js():
    path = os.path.join(WEB_DIR, "app.js")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    return Response(content=content, media_type="application/javascript", headers=NO_CACHE_HEADERS)

@app.get("/favicon.svg")
@app.get("/favicon.ico")
def serve_favicon():
    path = os.path.join(WEB_DIR, "favicon.svg")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    return Response(content=content, media_type="image/svg+xml", headers=NO_CACHE_HEADERS)

# 1. Generate 6-Digit Pairing Code
@app.post("/api/pairing/create")
def create_pairing_code():
    code = ''.join(random.choices(string.digits, k=6))
    expires = datetime.now(timezone.utc) + timedelta(minutes=10)
    pairing_codes[code] = {"expires_at": expires, "used": False}
    print(f"🔑 Generated 6-Digit Pairing Code: {code}")
    return {"code": code, "expires_at": expires.isoformat()}

# 2. Verify 6-Digit Pairing Code (Called by Desktop Agent)
@app.post("/api/pairing/verify")
def verify_pairing(req: PairingVerifyRequest):
    code_info = pairing_codes.get(req.code)
    if not code_info:
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
    print(f"✅ Device '{req.device_name}' paired successfully! Device ID: {device_id}")

    return {
        "status": "SUCCESS",
        "device_id": device_id,
        "secret_key": secret_key
    }

# 3. Authenticated Agent WebSocket Endpoint
@app.websocket("/ws/agent")
async def websocket_agent(websocket: WebSocket, device_id: str = None, secret_key: str = None):
    device_info = registered_devices.get(device_id)
    if not device_info or device_info["secret_key"] != secret_key:
        print(f"⛔ Unauthorized connection attempt by device_id: {device_id}")
        await websocket.close(code=4001)
        return

    await manager.connect_agent(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            await manager.broadcast_to_clients(payload)
    except WebSocketDisconnect:
        manager.disconnect_agent()

# 4. Mobile / Web Client Connection Endpoint
@app.websocket("/ws/client")
async def websocket_client(websocket: WebSocket):
    await manager.connect_client(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            cmd = payload.get('command')
            stdin = payload.get('stdin')
            msg_type = payload.get('type')
            
            # Allow forwarding of specific message types
            if msg_type == "INPUT":
                print(f"⌨️  Input from phone: {payload.get('data', '')[:50]}")
            elif msg_type in ["RESIZE", "CHAT"]:
                pass # Forward quietly
            elif cmd:
                print(f"📤 Command from phone: {cmd}")
            elif stdin:
                print(f"📤 Stdin input from phone: {stdin}")
            else:
                continue  # skip unknown messages
                
            success = await manager.send_to_agent(payload)
            if not success:
                await websocket.send_text(json.dumps({
                    "type": "STDERR",
                    "data": "ERROR: Desktop Agent is OFFLINE or UNPAIRED!\n"
                }))
    except WebSocketDisconnect:
        manager.disconnect_client(websocket)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
