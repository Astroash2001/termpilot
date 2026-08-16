import os
import sys
import json
import asyncio
import platform
import shutil
import threading
import urllib.request
import websockets
from winpty import PtyProcess

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")
BACKEND_HTTP_URL = "http://localhost:8000"

active_pty = None

def get_system_shell_cmd():
    """Return PowerShell as a single string for PTY spawning."""
    ps = shutil.which("powershell.exe")
    if ps:
        return ps
    return r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

def load_config() -> dict:
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error reading config.json: {e}")
    return {}

def save_config(config_data: dict):
    with open(CONFIG_FILE, "w") as f:
        json.dump(config_data, f, indent=4)
    print(f"💾 Saved device configuration to {CONFIG_FILE}")

def pair_device(pairing_code: str, device_name: str = None):
    if not device_name:
        device_name = platform.node() or "Windows-PC"
    
    print(f"\n🔑 Attempting pairing using code '{pairing_code}' for device '{device_name}'...")
    url = f"{BACKEND_HTTP_URL}/api/pairing/verify"
    payload = json.dumps({"code": pairing_code, "device_name": device_name}).encode('utf-8')
    
    req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            config = {
                "device_id": res_data["device_id"],
                "secret_key": res_data["secret_key"],
                "device_name": device_name
            }
            save_config(config)
            print("✅ Device paired successfully! You can now run 'python agent.py' to start.\n")
            return True
    except Exception as e:
        print(f"❌ Pairing failed: {e}\n")
        return False

def start_pty_session(ws, loop):
    """Start a persistent PowerShell session using winpty."""
    global active_pty
    
    if active_pty and active_pty.isalive():
        print("PTY is already running.")
        return

    shell_bin = get_system_shell_cmd()
    cwd = os.path.expanduser("~")
    env = os.environ.copy()
    
    try:
        # Default starting dimensions, will be resized by client
        active_pty = PtyProcess.spawn([shell_bin], cwd=cwd, env=env, dimensions=(24, 80))
        print(f"🚀 Started persistent PTY session (PID: {active_pty.pid})")
    except Exception as e:
        print(f"❌ Failed to spawn PTY process: {e}")
        import traceback
        traceback.print_exc()
        return

    def read_pty_output():
        """Continuously read raw PTY output and send to the browser."""
        while active_pty and active_pty.isalive():
            try:
                data = active_pty.read(4096)
                if data:
                    # Print locally for debugging
                    sys.stdout.write(data)
                    sys.stdout.flush()
                    # Forward to WebSocket
                    asyncio.run_coroutine_threadsafe(
                        ws.send(json.dumps({
                            "type": "RAW",
                            "data": data
                        })),
                        loop
                    )
            except EOFError:
                print("📄 PTY EOF reached.")
                break
            except Exception as e:
                print(f"❌ PTY read error: {e}")
                import traceback
                traceback.print_exc()
                break
        print("🛑 PTY session ended.")

    reader_thread = threading.Thread(target=read_pty_output, daemon=True)
    reader_thread.start()

async def start_agent():
    global active_pty
    config = load_config()
    device_id = config.get("device_id")
    secret_key = config.get("secret_key")

    if not device_id or not secret_key:
        print("❌ Agent is NOT paired!")
        print("👉 Run: python agent.py --pair <6-digit-code>\n")
        return

    server_url = f"ws://localhost:8000/ws/agent?device_id={device_id}&secret_key={secret_key}"
    print(f"Connecting Desktop Agent (ID: {device_id[:8]}...) to Relay Server...")

    while True:
        try:
            async with websockets.connect(server_url) as ws:
                print("🟢 Authenticated Desktop Agent Connected & Ready!\n")
                
                # Start the persistent terminal session when connected
                start_pty_session(ws, asyncio.get_running_loop())

                while True:
                    message_text = await ws.recv()
                    payload = json.loads(message_text)
                    msg_type = payload.get("type")

                    if msg_type == "INPUT":
                        data = payload.get("data", "")
                        if active_pty and active_pty.isalive():
                            active_pty.write(data)
                    
                    elif msg_type == "RESIZE":
                        cols = payload.get("cols", 80)
                        rows = payload.get("rows", 24)
                        if active_pty and active_pty.isalive():
                            try:
                                active_pty.setwinsize(rows, cols)
                            except Exception as e:
                                print(f"Error resizing PTY: {e}")
                                
        except websockets.exceptions.ConnectionClosed:
            print("⚠️ Connection to relay lost. Retrying in 3 seconds...")
            await asyncio.sleep(3)
        except Exception as e:
            print(f"⚠️ Error: {e}. Retrying in 3 seconds...")
            await asyncio.sleep(3)

if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--pair":
        code = sys.argv[2]
        name = sys.argv[3] if len(sys.argv) > 3 else None
        pair_device(code, name)
    else:
        asyncio.run(start_agent())
