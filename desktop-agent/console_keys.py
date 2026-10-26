"""Type into a program's console window on this PC, as if someone pressed the keys there.

Lets the phone hand a Claude session over from a plain `claude` started in any laptop window
(Windows Terminal, VS Code, PowerShell): /exit is typed into Claude to close it, and later
`claude --resume <id>` is typed into the shell left in that same window to bring it back.

A process can sit in one console only, and the PC agent needs its own, so the typing runs in a
short-lived copy of this file with no console of its own:
    python console_keys.py <pid> <text>
It attaches to the console of <pid>, queues <text> as key presses, and prints the ids of every
process in that console (the shell among them) as JSON.
"""
import ctypes
import json
import subprocess
import sys
from ctypes import wintypes

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32.OpenProcess.restype = kernel32.CreateFileW.restype = wintypes.HANDLE  # not truncated to int
INVALID_HANDLE = wintypes.HANDLE(-1).value
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
STILL_ACTIVE = 259
DETACHED_PROCESS = 0x00000008


def started_at(pid):
    """Creation time of a running process as a FILETIME count, or None if it is not running.
    A pid alone can be reused by another program once the first one exits."""
    h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return None
    h = wintypes.HANDLE(h)
    try:
        code = wintypes.DWORD()
        times = [wintypes.FILETIME() for _ in range(4)]
        if not kernel32.GetExitCodeProcess(h, ctypes.byref(code)) or code.value != STILL_ACTIVE:
            return None
        if not kernel32.GetProcessTimes(h, *[ctypes.byref(t) for t in times]):
            return None
        return (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
    finally:
        kernel32.CloseHandle(h)


def type_into(pid, text, timeout=10):
    """Type text into the console that pid runs in. Returns the pids in that console, [] on failure."""
    try:
        out = subprocess.run([sys.executable, __file__, str(pid), text], capture_output=True, text=True,
                             timeout=timeout, creationflags=DETACHED_PROCESS).stdout
        return json.loads(out or "[]")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return []


class KEY_EVENT_RECORD(ctypes.Structure):
    _fields_ = [("bKeyDown", wintypes.BOOL), ("wRepeatCount", wintypes.WORD), ("wVirtualKeyCode", wintypes.WORD),
                ("wVirtualScanCode", wintypes.WORD), ("UnicodeChar", wintypes.WCHAR), ("dwControlKeyState", wintypes.DWORD)]


class INPUT_RECORD(ctypes.Structure):
    class _Event(ctypes.Union):
        _fields_ = [("KeyEvent", KEY_EVENT_RECORD), ("_pad", ctypes.c_byte * 16)]
    _fields_ = [("EventType", wintypes.WORD), ("Event", _Event)]


def key_records(text):
    records = []
    for ch in text:
        vk = {"\r": 0x0D, "\x1b": 0x1B}.get(ch) or (user32.VkKeyScanW(ch) & 0xFF)
        for down in (True, False):
            r = INPUT_RECORD()
            r.EventType = 1  # KEY_EVENT
            r.Event.KeyEvent = KEY_EVENT_RECORD(down, 1, vk, user32.MapVirtualKeyW(vk, 0), ch, 0)
            records.append(r)
    return records


def attach_and_type(pid, text):
    kernel32.FreeConsole()
    if not kernel32.AttachConsole(pid):
        return []
    h = kernel32.CreateFileW("CONIN$", 0xC0000000, 3, None, 3, 0, None)  # read/write, shared, open existing
    if h in (None, INVALID_HANDLE):
        return []
    h = wintypes.HANDLE(h)
    records = key_records(text)
    written = wintypes.DWORD()
    ok = kernel32.WriteConsoleInputW(h, (INPUT_RECORD * len(records))(*records), len(records), ctypes.byref(written))
    kernel32.CloseHandle(h)
    pids = (wintypes.DWORD * 64)()
    n = kernel32.GetConsoleProcessList(pids, 64)
    return [p for p in pids[:min(n, 64)] if p != kernel32.GetCurrentProcessId()] if ok else []


if __name__ == "__main__":
    print(json.dumps(attach_and_type(int(sys.argv[1]), sys.argv[2])))
