"""TermPilot for the PC: one window that starts the relay and the PC terminal, shows that both
are up, gives the phone link, opens the add-a-phone page, and stops everything when closed.

Run: backend\\venv\\Scripts\\pythonw.exe TermPilot.pyw (pythonw: no console window of its own)
Nothing starts with Windows; this only runs when opened.
"""
import os
import re
import socket
import subprocess
import threading
import tkinter as tk
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(ROOT, "backend")
AGENT = os.path.join(ROOT, "desktop-agent")
NO_WINDOW = subprocess.CREATE_NO_WINDOW
# The PC terminal gets its own console window: that is where it can be used at the desk
NEW_CONSOLE = subprocess.CREATE_NEW_CONSOLE

PAPER, INK, SOFT, ACCENT, OK, BAD = "#fbfaf5", "#1d1a16", "#5c5348", "#c4007a", "#3f6417", "#a8231c"
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def port_in_use(port=8000):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def kill_tree(proc):
    # The relay owns ngrok; the PC terminal owns PowerShell and the chat agents
    if proc and proc.poll() is None:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], creationflags=NO_WINDOW,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class App:
    def __init__(self, root):
        self.root = root
        self.relay = self.agent = None
        self.phone_url = ""
        root.title("TermPilot")
        root.iconbitmap(os.path.join(ROOT, "TermPilot.ico"))
        root.configure(bg=PAPER, padx=24, pady=20)
        root.resizable(False, False)

        def label(text="", size=11, bold=False, fg=INK):
            w = tk.Label(root, text=text, bg=PAPER, fg=fg, anchor="w", justify="left",
                         font=("Segoe UI", size, "bold" if bold else "normal"), wraplength=360)
            w.pack(fill="x", pady=(0, 6))
            return w

        def button(text, command, primary=False):
            w = tk.Button(root, text=text, command=command, relief="solid", bd=2, cursor="hand2",
                          font=("Segoe UI", 11, "bold"), padx=12, pady=8,
                          bg=ACCENT if primary else PAPER, fg=PAPER if primary else INK,
                          activebackground=INK, activeforeground=PAPER)
            w.pack(fill="x", pady=(4, 6))
            return w

        label("TERMPILOT", 10, True, SOFT)
        self.status = label("Starting…", 16, True)
        self.relay_line = label("Relay: starting", fg=SOFT)
        self.pc_line = label("PC terminal: waiting for the relay", fg=SOFT)
        self.link_line = label("", fg=SOFT)
        self.copy_btn = button("Copy phone link", self.copy_link)
        self.term_btn = button("Open PC terminal", self.start_agent)
        # The PC-only enroll page shows a fresh one-use QR code each time
        self.add_btn = button("Add a phone", lambda: webbrowser.open("http://localhost:8000/enroll"))
        button("Stop TermPilot", self.stop, primary=True)
        self.copy_btn.configure(state="disabled")
        self.term_btn.pack_forget()
        root.protocol("WM_DELETE_WINDOW", self.stop)

        if port_in_use():
            self.set_status("TermPilot is already running.", BAD)
            self.relay_line.configure(text="Something is already using port 8000. Close the other TermPilot first.")
            return
        self.start_relay()
        self.watch()

    def set_status(self, text, color=INK):
        self.status.configure(text=text, fg=color)

    def start_relay(self):
        env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
        self.relay = subprocess.Popen(
            [os.path.join(BACKEND, "venv", "Scripts", "python.exe"), "main.py"], cwd=BACKEND, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
            errors="replace", creationflags=NO_WINDOW)
        threading.Thread(target=self.read_relay, daemon=True).start()

    def read_relay(self):
        # Keeps draining after startup, or the relay would block on a full pipe
        for line in self.relay.stdout:
            self.root.after(0, self.on_relay_line, ANSI.sub("", line).strip())

    def on_relay_line(self, line):
        if "PUBLIC PHONE URL:" in line:
            self.phone_url = line.split("PUBLIC PHONE URL:", 1)[1].strip()
        elif line.startswith("Or open:") and not self.phone_url:
            # No tunnel: the local link, without its one-use enroll code
            self.phone_url = line.split("Or open:", 1)[1].strip().split("#", 1)[0]
        elif "Application startup complete" in line:
            if self.phone_url.startswith("https"):
                self.relay_line.configure(text="Relay: running", fg=OK)
            else:  # ngrok failed or is turned off: phones away from this PC can't reach it
                self.relay_line.configure(text="Relay: on this PC only, no phone link from outside.", fg=BAD)
            self.link_line.configure(text="Phone link: " + self.phone_url)
            self.copy_btn.configure(state="normal")
            self.start_agent()
        elif "Desktop Agent Connected" in line:
            self.pc_line.configure(text="PC terminal: connected", fg=OK)
            self.set_status("Ready. Open TermPilot on your phone.", OK)
        elif "Desktop Agent Disconnected" in line:
            self.pc_line.configure(text="PC terminal: not connected", fg=BAD)
            self.set_status("The PC terminal is not connected.", BAD)

    def start_agent(self):
        if self.agent and self.agent.poll() is None:
            return
        self.agent = subprocess.Popen([os.path.join(AGENT, "venv", "Scripts", "python.exe"), "agent.py"],
                                      cwd=AGENT, creationflags=NEW_CONSOLE)
        self.pc_line.configure(text="PC terminal: starting", fg=SOFT)
        self.term_btn.pack_forget()

    def watch(self):
        # Every 2 s: did the relay or the PC terminal window close on its own?
        if self.relay.poll() is not None:
            self.set_status("The relay stopped. Close this window and open TermPilot again.", BAD)
            self.relay_line.configure(text="Relay: stopped", fg=BAD)
            return
        if self.agent and self.agent.poll() is not None and not self.term_btn.winfo_ismapped():
            self.pc_line.configure(text="PC terminal: closed", fg=BAD)
            self.set_status("The PC terminal window was closed.", BAD)
            self.term_btn.pack(fill="x", pady=(4, 6), before=self.add_btn)
        self.root.after(2000, self.watch)

    def copy_link(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.phone_url)
        self.copy_btn.configure(text="Copied")
        self.root.after(1500, lambda: self.copy_btn.configure(text="Copy phone link"))

    def stop(self):
        kill_tree(self.agent)
        kill_tree(self.relay)
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    App(root)
    root.mainloop()
