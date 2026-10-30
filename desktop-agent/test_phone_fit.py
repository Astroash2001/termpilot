"""Self-check for phone fit: who sizes the PTY. Run: venv\\Scripts\\python.exe test_phone_fit.py"""
import agent


class FakePty:
    def __init__(self):
        self.sizes = []

    def isalive(self):
        return True

    def setwinsize(self, rows, cols):
        self.sizes.append((cols, rows))


sent = []
agent.send_to_relay = sent.append
agent.host_size = lambda: (120, 30)
agent.active_pty = pty = FakePty()
agent.pty_size = (120, 30)

# RESIZE off the network is validated
assert agent.parse_phone_size({"cols": 48, "rows": 40}) == (48, 40)
assert agent.parse_phone_size({"cols": "48", "rows": 40}) == (48, 40)
assert agent.parse_phone_size({"cols": 5, "rows": 40}) is None
assert agent.parse_phone_size({"cols": 48, "rows": 9999}) is None
assert agent.parse_phone_size({"cols": None, "rows": 40}) is None
assert agent.parse_phone_size({}) is None

# The phone reports its screen: the PTY takes the phone's size, size announced first
agent.phone_size = (48, 40)
agent.give_size_to("phone")
assert pty.sizes == [(48, 40)]
assert sent[-1] == {"type": "PTY_SIZE", "cols": 48, "rows": 40, "owner": "phone"}

# More phone typing changes nothing
agent.give_size_to("phone")
assert pty.sizes == [(48, 40)]

# Typing on the PC takes it back, then the phone's next input takes it again
agent.give_size_to("host")
agent.give_size_to("phone")
assert pty.sizes == [(48, 40), (120, 30), (48, 40)]

# No phone size known (all phones gone): the phone can't claim it
agent.phone_size = None
agent.give_size_to("host")
agent.give_size_to("phone")
assert pty.sizes[-1] == (120, 30) and agent.size_owner == "host"

# The Home slider. All phones gone, then one arrives: its first RESIZE takes control
agent.phone_size = None
agent.give_size_to("host")
agent.phone_resized((50, 40))
assert pty.sizes[-1] == (50, 40) and sent[-1]["owner"] == "phone"

# Slid to PC: the PC's size, and a later phone RESIZE (a rotation) doesn't take it back
agent.phone_control("pc")
assert pty.sizes[-1] == (120, 30) and sent[-1]["owner"] == "host"
agent.phone_resized((90, 20))
assert pty.sizes[-1] == (120, 30) and sent[-1] == {"type": "PTY_SIZE", "cols": 120, "rows": 30, "owner": "host"}

# Slid back to the phone: its latest size; junk owners change nothing
agent.phone_control("phone")
assert pty.sizes[-1] == (90, 20) and agent.size_owner == "phone"
agent.phone_control("everyone")
assert agent.size_owner == "phone"

print("phone fit: all checks passed")
