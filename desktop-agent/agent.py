import os
import sys
import re
import json
import asyncio
import platform
import shutil
import threading
import time
import msvcrt
import urllib.request
import websockets
from winpty import PtyProcess

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")
BACKEND_HTTP_URL = "http://localhost:8000"

active_pty = None

# Regex to match and strip ANSI Device Attributes (DA1 / DA2 / CPR) probe responses
# e.g., \x1b[?61;4;6;7;14;21;22;23;24;28;32;42;52c or raw [?61;...c
DA_RESPONSE_REGEX = re.compile(r'(\x1b)?\[\?[0-9;]*[a-zA-Z]|(\x1b)?\[>[0-9;]*[a-zA-Z]|(\x1b)?\[[0-9;]*R')

def clean_pty_output(data: str) -> str:
    """Strip Device Attribute / probe response sequences from PTY output."""
    if not data:
        return data
    cleaned = DA_RESPONSE_REGEX.sub('', data)
    return cleaned

def safe_pty_write(data: str):
    """Write input to PTY while stripping any leaked Device Attribute / probe sequences."""
    if not data or not active_pty or not active_pty.isalive():
        return
    cleaned = DA_RESPONSE_REGEX.sub('', data)
    if cleaned:
        active_pty.write(cleaned)

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
    
    # Detect natural terminal size from the host console
    ts = shutil.get_terminal_size(fallback=(100, 30))
    try:
        # Spawn PowerShell with PSReadLine disabled so that terminal resize events
        # don't trigger PSReadLine VT attribute probes (\x1b[c) that leak DA responses
        # (\x1b[?61;...c) into stdin.
        spawn_cmd = [
            shell_bin,
            "-NoLogo",
            "-NoExit",
            "-Command",
            (
                "Remove-Module PSReadLine -ErrorAction SilentlyContinue; "
                "Start-Sleep -Milliseconds 500; "
                "try { $Host.UI.RawUI.FlushInputBuffer() } catch {}; "
                "Clear-Host"
            )
        ]
        active_pty = PtyProcess.spawn(spawn_cmd, cwd=cwd, env=env, dimensions=(ts.lines, ts.columns))
        print(f"🚀 Started persistent PTY session (PID: {active_pty.pid}, size: {ts.columns}x{ts.lines})")
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
                    # Strip DA/DA2/CPR probe responses so they never reach
                    # the local console or the browser terminal
                    data = clean_pty_output(data)
                    if not data:
                        continue
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

    def read_local_input():
        """Read keyboard input and track console resize — keeps PTY in sync with the laptop window."""
        SPECIAL_KEYS = {
            b'H': '\x1b[A',   # Up arrow
            b'P': '\x1b[B',   # Down arrow
            b'M': '\x1b[C',   # Right arrow
            b'K': '\x1b[D',   # Left arrow
            b'G': '\x1b[H',   # Home
            b'O': '\x1b[F',   # End
            b'I': '\x1b[5~',  # Page Up
            b'Q': '\x1b[6~',  # Page Down
            b'S': '\x1b[3~',  # Delete
            b'R': '\x1b[2~',  # Insert
            b';': '\x1bOP',   # F1
            b'<': '\x1bOQ',   # F2
            b'=': '\x1bOR',   # F3
            b'>': '\x1bOS',   # F4
        }
        last_cols, last_rows = ts.columns, ts.lines
        while active_pty and active_pty.isalive():
            try:
                # Sync PTY size with the laptop console window
                cur = shutil.get_terminal_size(fallback=(last_cols, last_rows))
                if cur.columns != last_cols or cur.lines != last_rows:
                    last_cols, last_rows = cur.columns, cur.lines
                    if active_pty and active_pty.isalive():
                        active_pty.setwinsize(last_rows, last_cols)

                if msvcrt.kbhit():
                    ch = msvcrt.getwch()
                    if ch in ('\x00', '\xe0'):
                        scan = msvcrt.getch()
                        seq = SPECIAL_KEYS.get(scan, '')
                        if seq:
                            safe_pty_write(seq)
                    else:
                        safe_pty_write(ch)
                else:
                    time.sleep(0.01)
            except Exception:
                break

    input_thread = threading.Thread(target=read_local_input, daemon=True)
    input_thread.start()

    def _flush_startup_garbage():
        """Wait for PowerShell to fully initialize, then flush any DA probe
        data that leaked into the input buffer so the first real command
        executes cleanly."""
        time.sleep(2.0)
        if active_pty and active_pty.isalive():
            # Submit whatever garbage is in the buffer (harmless blank or error)
            active_pty.write("\r")
            time.sleep(0.5)
            # Clear the screen so the user sees a pristine prompt
            active_pty.write("Clear-Host\r")

    threading.Thread(target=_flush_startup_garbage, daemon=True).start()

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
                        safe_pty_write(data)
                                
        except websockets.exceptions.ConnectionClosed as e:
            if e.code == 4001:
                print("❌ Authentication failed: Server rejected device credentials.")
                print("👉 Please re-pair your device by running: python agent.py --pair <6-digit-code>\n")
                return
            print("⚠️ Connection to relay lost. Retrying in 3 seconds...")
            await asyncio.sleep(3)
        except websockets.exceptions.InvalidStatusCode as e:
            if e.status_code in (401, 403, 4001, 500):
                print(f"❌ Server rejected connection (HTTP {e.status_code}). Device credentials may need re-pairing.")
                print("👉 Please re-pair your device by running: python agent.py --pair <6-digit-code>\n")
                return
            print(f"⚠️ Error: {e}. Retrying in 3 seconds...")
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
