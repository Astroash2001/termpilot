"""Self-check for phone alerts (Web Push). Run: venv\\Scripts\\python.exe test_push.py

A fake push service on localhost receives a real push, decrypts it the way the phone
would, and checks the VAPID signature against the key the relay gives the phone."""
import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import http_ece
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

import main

b64 = lambda raw: base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
unb64 = lambda s: base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

received = []


class FakePushService(BaseHTTPRequestHandler):
    status = 201

    def do_POST(self):
        received.append(({k.lower(): v for k, v in self.headers.items()}, self.rfile.read(int(self.headers["Content-Length"]))))
        self.send_response(FakePushService.status)
        self.end_headers()

    def log_message(self, *args):
        pass


def check_alerts():
    m = main.ConnectionManager()
    m.alert_for({"type": "CHAT_SESSIONS", "agents": {"claude": "Claude Code"},
                 "sessions": [{"sid": "s1", "agent": "claude", "title": "Fix relay"}]})
    assert m.alert_for({"type": "CHAT_STATE", "sid": "s1", "state": "thinking"}) is None
    ask = m.alert_for({"type": "CHAT_PERMISSION", "sid": "s1", "toolCall": {"title": "Write hello.txt"}})
    assert ask == {"tag": "s1", "url": "/#chat/s1", "title": "Claude Code needs your OK", "body": "Write hello.txt"}
    m.alert_for({"type": "CHAT_STATE", "sid": "s1", "state": "needs_you"})
    assert m.alert_for({"type": "CHAT_STATE", "sid": "s1", "state": "idle"})["title"] == "Claude Code is done"
    # Idle again (a sync, a mode change) is not a second "done"
    assert m.alert_for({"type": "CHAT_STATE", "sid": "s1", "state": "idle"}) is None
    assert m.alert_for({"type": "CHAT_STATE", "sid": "s1", "state": "error", "reason": "boom"})["body"] == "boom"
    assert m.alert_for({"type": "RAW", "data": "x"}) is None


def check_subscription_validation():
    keys = {"p256dh": "a", "auth": "b"}
    assert main.valid_subscription({"endpoint": "https://fcm.googleapis.com/x", "keys": keys})
    assert not main.valid_subscription({"endpoint": "http://127.0.0.1/x", "keys": keys})
    assert not main.valid_subscription({"endpoint": "file:///etc/passwd", "keys": keys})
    assert not main.valid_subscription({"endpoint": "https://x", "keys": {"p256dh": "a"}})
    assert not main.valid_subscription("https://x")


def check_round_trip():
    server = HTTPServer(("127.0.0.1", 0), FakePushService)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    # The phone's side: its own key pair and auth secret, as PushManager.subscribe makes them
    phone_key = ec.generate_private_key(ec.SECP256R1())
    phone_pub = phone_key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    auth = b"0123456789abcdef"
    # http on localhost only here: the relay refuses non-https endpoints from phones
    sub = {"endpoint": f"http://127.0.0.1:{server.server_port}/push/abc", "keys": {"p256dh": b64(phone_pub), "auth": b64(auth)}}
    alert = {"tag": "s1", "url": "/#chat/s1", "title": "Claude Code needs your OK", "body": "Write hello.txt"}

    assert main.send_push([sub], alert) == []
    headers, body = received[-1]
    plain = http_ece.decrypt(body, private_key=phone_key, auth_secret=auth, version="aes128gcm")
    assert json.loads(plain) == alert

    # VAPID: signed by the key whose public half the relay sends the phone in AUTH_OK
    scheme, params = headers["authorization"].split(" ", 1)
    fields = dict(p.strip().split("=", 1) for p in params.split(","))
    assert scheme == "vapid" and fields["k"] == main.PUSH["public_key"]
    head, claims, sig = fields["t"].split(".")
    assert json.loads(unb64(claims))["sub"] == main.PUSH_SUB
    raw_sig = unb64(sig)
    der = encode_dss_signature(int.from_bytes(raw_sig[:32], "big"), int.from_bytes(raw_sig[32:], "big"))
    relay_pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), unb64(main.PUSH["public_key"]))
    relay_pub.verify(der, f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))

    # A phone that unsubscribed: the push service answers 410 and the relay forgets it
    FakePushService.status = 410
    assert main.send_push([sub], alert) == [sub["endpoint"]]
    server.shutdown()


check_alerts()
check_subscription_validation()
check_round_trip()
print("push: all checks pass")
