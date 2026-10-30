"""Self-check for the PC app's reading of relay output. Starts nothing.
Run: backend\\venv\\Scripts\\python.exe test_pc_app.py"""
import importlib.util
import tkinter as tk

spec = importlib.util.spec_from_file_location("pc_app", "TermPilot.pyw")
pc_app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pc_app)

pc_app.port_in_use = lambda: True  # constructs the window without starting the relay
started = []
pc_app.App.start_agent = lambda self: started.append(1)

root = tk.Tk()
root.withdraw()
app = pc_app.App(root)
feed = app.on_relay_line

feed("📱 PUBLIC PHONE URL: https://example.ngrok-free.dev")
feed("Or open: https://example.ngrok-free.dev/#enroll=SECRET")
feed("INFO:     Application startup complete.")
assert app.phone_url == "https://example.ngrok-free.dev"
assert "SECRET" not in app.link_line["text"] and started == [1]
assert app.copy_btn["state"] == "normal"

feed("🟢 Authenticated Desktop Agent Connected!")
assert app.status["text"].startswith("Ready") and app.pc_line["text"] == "PC terminal: connected"
feed("🔴 Desktop Agent Disconnected.")
assert app.pc_line["text"] == "PC terminal: not connected"

# No tunnel: the local link, never the one-use enroll code
app.phone_url = ""
feed("Or open: http://localhost:8000/#enroll=SECRET")
assert app.phone_url == "http://localhost:8000/"

root.destroy()
print("pc app: all checks pass")
