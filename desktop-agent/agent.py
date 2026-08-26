import os
import sys
import re
import json
import atexit
import asyncio
import platform
import shutil
import threading
import time
import msvcrt
import urllib.request
import websockets
import winpty
from winpty import PtyProcess

# Ensure UTF-8 output encoding on Windows consoles so emojis and unicode symbols print cleanly.
# newline="" disables the text layer's newline translation. Without it Python rewrites every
# bare \n as \r\n on the way to the console, which destroys the distinction ConPTY relies on:
# it emits \r\n when it means "next line, column 0" and a bare \n when it means "down one row,
# keep the column". Translating the second into the first drops rendering at column 0.
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace", newline="")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace", newline="")
    except Exception:
        pass

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")
BACKEND_HTTP_URL = "http://localhost:8000"

active_pty = None

_console_owned_by_pty = False
_original_console_mode = None
AGENT_LOG_FILE = os.path.join(os.path.dirname(__file__), "agent.log")

# DISABLE_NEWLINE_AUTO_RETURN. Clear it and the console turns every \n into CR+LF;
# set it and \n is a pure line feed that leaves the column alone, which is what ConPTY
# and the VT apps running inside it assume.
DISABLE_NEWLINE_AUTO_RETURN = 0x0008

def _set_newline_auto_return(enabled: bool):
    """Choose what a bare \\n means on the host console, remembering the mode we found."""
    global _original_console_mode
    if platform.system() != "Windows":
        return
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        for handle_id in (-11, -12):  # STD_OUTPUT_HANDLE, STD_ERROR_HANDLE
            h = kernel32.GetStdHandle(handle_id)
            mode = ctypes.c_ulong()
            if not kernel32.GetConsoleMode(h, ctypes.byref(mode)):
                continue
            if handle_id == -11 and _original_console_mode is None:
                _original_console_mode = mode.value
            new = (mode.value & ~DISABLE_NEWLINE_AUTO_RETURN) if enabled \
                else (mode.value | DISABLE_NEWLINE_AUTO_RETURN)
            kernel32.SetConsoleMode(h, new)
    except Exception:
        pass

def restore_console_mode():
    """Put the console back the way we found it, so the user's shell isn't left with
    pure-linefeed semantics (which would staircase every command they run afterwards)."""
    if _original_console_mode is None or platform.system() != "Windows":
        return
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        for handle_id in (-11, -12):
            kernel32.SetConsoleMode(kernel32.GetStdHandle(handle_id), _original_console_mode)
    except Exception:
        pass

atexit.register(restore_console_mode)

def agent_print(msg):
    """Agent status output.

    Goes to the console until the PTY takes the console over, and to agent.log after
    that. Once the mirror is running the console belongs to the PTY replay alone -- see
    align_console_origin() for why a single stray line breaks rendering permanently.
    """
    if _console_owned_by_pty:
        try:
            with open(AGENT_LOG_FILE, "a", encoding="utf-8") as f:
                f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
        except Exception:
            pass
    else:
        print(msg)

def align_console_origin():
    """Align the host console's viewport origin with the ConPTY buffer origin.

    The host console is a second terminal replaying the ConPTY's VT stream. ConPTY
    addresses rows absolutely (ESC[row;colH) counted from the top of its own buffer, so
    the two only agree while the host viewport starts on the same row the ConPTY buffer
    does. Clear the screen and the scrollback, home the cursor, and they coincide.

    After this the console belongs to the PTY: anything else that writes to it scrolls
    the host by a line the ConPTY never made, and every absolute cursor move from then
    on lands one row off. That offset never heals, which is why agent status messages
    switch to agent.log here.
    """
    global _console_owned_by_pty
    try:
        sys.stdout.write("\x1b[2J\x1b[3J\x1b[H")
        sys.stdout.flush()
        if platform.system() == "Windows":
            # ESC[3J scrollback support varies across conhost builds, so home via the
            # API as well rather than trusting the escape alone.
            import ctypes
            from ctypes import wintypes

            class _COORD(ctypes.Structure):
                _fields_ = [("X", wintypes.SHORT), ("Y", wintypes.SHORT)]

            kernel32 = ctypes.windll.kernel32
            kernel32.SetConsoleCursorPosition(kernel32.GetStdHandle(-11), _COORD(0, 0))
            # Now that only the PTY writes here, give \n the meaning ConPTY assumes:
            # a pure line feed that keeps the column. Until this point auto-return was
            # left on so the agent's own banner printed normally instead of staircasing.
            _set_newline_auto_return(False)
    except Exception:
        pass
    _console_owned_by_pty = True

# Regexes to match terminal queries (sent by the child app) and their responses.
# We strip these queries from the PTY output before printing to sys.stdout, otherwise the
# Windows host terminal auto-replies and injects the answer ([?61...c, ESC[24;1R) straight
# into our stdin buffer, where the input reader would forward it to the PTY as typed text.
TERMINAL_QUERY_REGEX = re.compile(
    r'\x1b\[[>=?]?[0-9;]*[cn]'                # DA1/DA2/DA3 and DSR/CPR requests (incl. ESC[6n)
    r'|\x1b\[\?[0-9;]*u'                      # kitty keyboard protocol query
    r'|\x1b\[>[0-9;]*q'                       # XTVERSION query
    r'|\x1b\[\?[0-9;]*\$p'                    # DECRQM mode request
    r'|\x1bP\+q[0-9A-Fa-f;]*(?:\x1b\\|\x07)'  # XTGETTCAP
    r'|\x1b\][0-9]+;\?(?:\x1b\\|\x07)'        # OSC foreground/background colour queries
)
# We still strip responses in case winpty passes one through from internal buffers
DA_RESPONSE_REGEX = re.compile(r'\x1b\[\?[0-9]+(?:;[0-9]+)*c|\x1b\[>[0-9]+(?:;[0-9]+)*c|\x1b\[[0-9]+;[0-9]+R')

def enable_virtual_terminal_processing():
    """Enable VT100 / ANSI escape sequence processing on the Windows host console while preserving auto-return on newlines."""
    if platform.system() == "Windows":
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            for handle_id in (-11, -12):  # STD_OUTPUT_HANDLE (-11), STD_ERROR_HANDLE (-12)
                h = kernel32.GetStdHandle(handle_id)
                mode = ctypes.c_ulong()
                if kernel32.GetConsoleMode(h, ctypes.byref(mode)):
                    # ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004.
                    # Auto-return stays on for now (DISABLE_NEWLINE_AUTO_RETURN cleared) so the
                    # agent's own startup messages print normally. align_console_origin() turns
                    # it off once the PTY owns the console and \n must mean a pure line feed.
                    kernel32.SetConsoleMode(h, (mode.value | 0x0004) & ~DISABLE_NEWLINE_AUTO_RETURN)
        except Exception:
            pass

def clean_pty_output(data: str) -> str:
    """Strip terminal queries and responses from PTY output."""
    if not data:
        return data
    cleaned = TERMINAL_QUERY_REGEX.sub('', data)
    cleaned = DA_RESPONSE_REGEX.sub('', cleaned)
    return cleaned

def safe_pty_write(data: str):
    """Write input to PTY cleanly."""
    if not data or not active_pty or not active_pty.isalive():
        return
    # Strip any leaked responses from websocket input just in case
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
    
    # Check before touching console modes: on a relay reconnect the PTY is still alive and
    # still owns the console. Re-running enable_virtual_terminal_processing() here would put
    # auto-return back on and break \n semantics for a session we never re-align.
    if active_pty and active_pty.isalive():
        agent_print("PTY is already running.")
        return

    enable_virtual_terminal_processing()

    shell_bin = get_system_shell_cmd()
    cwd = os.path.expanduser("~")
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env["FORCE_COLOR"] = "3"
    
    # Detect natural terminal size from the host console
    ts = shutil.get_terminal_size(fallback=(100, 30))
    try:
        spawn_cmd = [
            shell_bin,
            "-NoLogo",
            "-NoExit",
            "-Command",
            (
                "& { "
                "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
                "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; "
                "$OutputEncoding = [System.Text.Encoding]::UTF8; "
                "$env:TERM = 'xterm-256color'; "
                "$env:COLORTERM = 'truecolor'; "
                "Start-Sleep -Milliseconds 400; "
                "try { (Get-Host).UI.RawUI.FlushInputBuffer() } catch { $null }; "
                "Clear-Host "
                "}"
            )
        ]
        # Use native Windows 10/11 ConPTY backend to eliminate legacy WinPTY buffer scraping bugs
        pty_backend = getattr(winpty.Backend, "ConPTY", None) if hasattr(winpty, "Backend") else None
        active_pty = PtyProcess.spawn(
            spawn_cmd,
            cwd=cwd,
            env=env,
            dimensions=(ts.lines, ts.columns),
            backend=pty_backend
        )
        agent_print(f"🚀 Started persistent PTY session (PID: {active_pty.pid}, size: {ts.columns}x{ts.lines}, backend: {pty_backend or 'default'})")
        # Announce initial PTY dimensions to backend & phone client
        asyncio.run_coroutine_threadsafe(
            ws.send(json.dumps({
                "type": "PTY_SIZE",
                "cols": ts.columns,
                "rows": ts.lines
            })),
            loop
        )
    except Exception as e:
        agent_print(f"❌ Failed to spawn PTY process: {e}")
        import traceback
        agent_print(traceback.format_exc())
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
                agent_print("📄 PTY EOF reached.")
                break
            except Exception as e:
                agent_print(f"❌ PTY read error: {e}")
                import traceback
                agent_print(traceback.format_exc())
                break
        agent_print("🛑 PTY session ended.")

    # Hand the console to the PTY. Must happen after every startup message above and
    # before the first byte of PTY output is mirrored, so the two origins coincide.
    align_console_origin()

    reader_thread = threading.Thread(target=read_pty_output, daemon=True)
    reader_thread.start()

    def read_local_input():
        """Read keyboard input and track console resize on the host laptop in strict FIFO order."""
        SPECIAL_KEYS_WIDE = {
            'H': '\x1b[A',   # Up arrow
            'P': '\x1b[B',   # Down arrow
            'M': '\x1b[C',   # Right arrow
            'K': '\x1b[D',   # Left arrow
            'G': '\x1b[H',   # Home
            'O': '\x1b[F',   # End
            'I': '\x1b[5~',  # Page Up
            'Q': '\x1b[6~',  # Page Down
            'S': '\x1b[3~',  # Delete
            'R': '\x1b[2~',  # Insert
            ';': '\x1bOP',   # F1
            '<': '\x1bOQ',   # F2
            '=': '\x1bOR',   # F3
            '>': '\x1bOS',   # F4
        }

        def swallow_terminal_reply(intro: str):
            """Discard the rest of an ANSI reply the host terminal injected into our stdin.

            Windows console keys never arrive as ANSI sequences (they come through as
            '\\x00'/'\\xe0' scan-code pairs), so an ESC followed immediately by '[', ']' or 'P'
            can only be a terminal auto-reply. Forwarding it to the PTY would make agy treat
            the coordinates as typed text and mis-place the caret.
            """
            deadline = time.time() + 0.05
            while time.time() < deadline:
                if not msvcrt.kbhit():
                    time.sleep(0.001)
                    continue
                c = msvcrt.getwch()
                deadline = time.time() + 0.05
                if intro == '[':
                    if '\x40' <= c <= '\x7e':  # final byte of a CSI sequence
                        return
                else:  # OSC / DCS reply, terminated by BEL or ST
                    if c == '\x07':
                        return
                    if c == '\x1b':
                        if msvcrt.kbhit():
                            msvcrt.getwch()  # the '\' of ST
                        return

        last_cols, last_rows = ts.columns, ts.lines
        while active_pty and active_pty.isalive():
            try:
                # Sync PTY size with the host laptop window dynamically
                cur = shutil.get_terminal_size(fallback=(last_cols, last_rows))
                if cur.columns != last_cols or cur.lines != last_rows:
                    last_cols, last_rows = cur.columns, cur.lines
                    if active_pty and active_pty.isalive():
                        active_pty.setwinsize(last_rows, last_cols)
                        # Notify connected clients of laptop window dimension update
                        asyncio.run_coroutine_threadsafe(
                            ws.send(json.dumps({
                                "type": "PTY_SIZE",
                                "cols": last_cols,
                                "rows": last_rows
                            })),
                            loop
                        )

                # Process all buffered keystrokes immediately in exact arrival order
                if msvcrt.kbhit():
                    pending = []
                    while msvcrt.kbhit():
                        ch = msvcrt.getwch()
                        if ch in ('\x00', '\xe0'):
                            # Consistent wide-character read for 2-byte special keys
                            scan = msvcrt.getwch()
                            seq = SPECIAL_KEYS_WIDE.get(scan, '')
                            if seq:
                                pending.append(seq)
                        elif ch == '\x1b':
                            # A lone ESC is the user's Escape key; ESC + '[', ']' or 'P'
                            # is an auto-reply from the host terminal, so drop it.
                            if not msvcrt.kbhit():
                                pending.append('\x1b')
                            else:
                                nxt = msvcrt.getwch()
                                if nxt in ('[', ']', 'P'):
                                    swallow_terminal_reply(nxt)
                                else:
                                    pending.append('\x1b')
                                    pending.append(nxt)
                        elif ch == '\r':
                            pending.append('\r')
                        elif ch == '\x08':
                            pending.append('\x08')
                        else:
                            pending.append(ch)
                    # Send the whole burst as one PTY write so ordering is preserved
                    if pending:
                        safe_pty_write(''.join(pending))
                else:
                    time.sleep(0.005)
            except Exception:
                break

    input_thread = threading.Thread(target=read_local_input, daemon=True)
    input_thread.start()

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
                agent_print("🟢 Authenticated Desktop Agent Connected & Ready!\n")
                
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
                agent_print("❌ Authentication failed: Server rejected device credentials.")
                agent_print("👉 Please re-pair your device by running: python agent.py --pair <6-digit-code>\n")
                return
            agent_print("⚠️ Connection to relay lost. Retrying in 3 seconds...")
            await asyncio.sleep(3)
        except websockets.exceptions.InvalidStatus as e:
            status_code = e.response.status_code if hasattr(e, "response") else getattr(e, "status_code", None)
            if status_code in (401, 403, 4001, 500):
                agent_print(f"❌ Server rejected connection (HTTP {status_code}). Device credentials may need re-pairing.")
                agent_print("👉 Please re-pair your device by running: python agent.py --pair <6-digit-code>\n")
                return
            agent_print(f"⚠️ Error: {e}. Retrying in 3 seconds...")
            await asyncio.sleep(3)
        except Exception as e:
            agent_print(f"⚠️ Error: {e}. Retrying in 3 seconds...")
            await asyncio.sleep(3)

if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--pair":
        code = sys.argv[2]
        name = sys.argv[3] if len(sys.argv) > 3 else None
        pair_device(code, name)
    else:
        asyncio.run(start_agent())
