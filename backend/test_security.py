"""Self-check for the relay's fixes to the 2026-10-26 Claude Security findings.
Run: venv\\Scripts\\python.exe test_security.py"""
import asyncio
import hashlib
import hmac
import json

import main


def check_tunnel_url():
    """F1: only an https ngrok host from our own ngrok child's log goes into the QR code."""
    line = lambda url, msg="started tunnel": json.dumps({"lvl": "info", "msg": msg, "obj": "tunnels", "url": url}).encode()
    assert main.tunnel_url_from_log(line("https://thinning-purify-agony.ngrok-free.dev")) == "https://thinning-purify-agony.ngrok-free.dev"
    assert main.tunnel_url_from_log(line("https://abc.ngrok.app/")) == "https://abc.ngrok.app"
    assert main.tunnel_url_from_log(line("https://attacker.example")) is None
    assert main.tunnel_url_from_log(line("https://ngrok-free.dev.attacker.example")) is None
    assert main.tunnel_url_from_log(line("http://abc.ngrok-free.dev")) is None
    assert main.tunnel_url_from_log(line("https://abc.ngrok-free.dev:8443")) is None
    assert main.tunnel_url_from_log(line("https://user@abc.ngrok-free.dev")) is None
    assert main.tunnel_url_from_log(line("https://abc.ngrok-free.dev", msg="starting web service")) is None
    assert main.tunnel_url_from_log(b"not json") is None
    assert main.tunnel_url_from_log(b"[1, 2]") is None


class FakeSocket:
    """Just enough of a Starlette WebSocket for the /ws/client handshake."""

    def __init__(self, first):
        self.inbox = [json.dumps(first)]
        self.sent, self.closed = [], None

    async def accept(self):
        pass

    async def receive_text(self):
        return self.inbox.pop(0)

    async def send_text(self, text):
        self.sent.append(json.loads(text))

    async def close(self, code=1000, reason=""):
        self.closed = code


class LocalRequest:
    """The agent's verify request, as is_direct_local sees it."""
    client = type("Client", (), {"host": "127.0.0.1"})()
    headers = {}


def check_pairing():
    main.save_registered_devices = lambda: None  # never touch the real devices.json
    try:
        # F3: no HTTP route takes the access key any more
        assert not any(getattr(r, "path", "") == "/api/pairing/create" for r in main.app.routes)

        # F3: the phone asks on the WebSocket, and only with the right key
        ws = FakeSocket({"type": "AUTH", "key": main.ACCESS_KEY, "purpose": "pair"})
        asyncio.run(main.websocket_client(ws))
        assert len(ws.sent) == 1 and ws.sent[0]["type"] == "PAIR_CODE" and ws.closed == 1000
        code = ws.sent[0]["code"]
        assert code in main.pairing_codes and ws not in main.manager.client_ws

        stranger = FakeSocket({"type": "AUTH", "key": "wrong", "purpose": "pair"})
        asyncio.run(main.websocket_client(stranger))
        assert stranger.sent == [] and stranger.closed == 4001

        # F2: an agent without a nonce is refused, and the code stays usable
        try:
            main.verify_pairing(main.PairingVerifyRequest(code=code), LocalRequest())
            raise AssertionError("verify without a nonce must fail")
        except main.HTTPException as e:
            assert e.status_code == 400
        assert not main.pairing_codes[code]["used"]

        # F2: the reply proves the relay holds the key in the user's profile
        nonce = "n" * 32
        res = main.verify_pairing(main.PairingVerifyRequest(code=code, nonce=nonce), LocalRequest())
        expected = hmac.new(main.RELAY_KEY, f"pair:{nonce}:{res['device_id']}:{res['secret_key']}".encode(), hashlib.sha256).hexdigest()
        assert res["proof"] == expected
        assert len(main.RELAY_KEY) >= 64
    finally:
        for device_id in [d for d, info in main.registered_devices.items() if info.get("name") == "Windows-PC" and d not in BEFORE]:
            del main.registered_devices[device_id]


BEFORE = set(main.registered_devices)
check_tunnel_url()
check_pairing()
print("security: all checks pass")
