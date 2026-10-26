"""Self-check for the agent/relay handshake. Run: venv\\Scripts\\python.exe test_relay_auth.py"""
import asyncio
import json
import os
import tempfile

import agent

SECRET = "device-secret"


class FakeRelay:
    """Plays the relay's side of the handshake; honest=False is a port squatter without the secret."""

    def __init__(self, honest: bool):
        self.honest = honest
        self.inbox = []
        self.outbox = [json.dumps({"type": "CHALLENGE", "nonce": "r" * 32})]

    async def recv(self):
        return self.outbox.pop(0)

    async def send(self, text):
        msg = json.loads(text)
        self.inbox.append(msg)
        key = SECRET if self.honest else "guess"
        self.outbox.append(json.dumps({"type": "AUTH_OK", "mac": agent.device_mac(key, "relay", msg["nonce"])}))


async def main():
    relay = FakeRelay(honest=True)
    assert await agent.prove_identities(relay, "dev-1", SECRET)
    sent = relay.inbox[0]
    # The secret itself never goes over the socket, only a MAC of the relay's nonce
    assert SECRET not in json.dumps(sent)
    assert sent["mac"] == agent.device_mac(SECRET, "agent", "r" * 32)

    # A squatter that doesn't know the secret can't pass as the relay
    assert not await agent.prove_identities(FakeRelay(honest=False), "dev-1", SECRET)

    # Something that isn't the relay's challenge is refused before anything is sent
    odd = FakeRelay(honest=True)
    odd.outbox = [json.dumps({"type": "INPUT", "data": "whoami\r"})]
    assert not await agent.prove_identities(odd, "dev-1", SECRET)
    assert odd.inbox == []

    check_pairing()
    print("relay auth: all checks passed")


class FakeResponse:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def check_pairing():
    """Pairing saves credentials only from the relay that holds the key in this user's profile."""
    key_dir = tempfile.mkdtemp()
    relay_key = "k" * 64
    with open(os.path.join(key_dir, "relay.key"), "w") as f:
        f.write(relay_key)
    agent.RELAY_KEY_FILE = os.path.join(key_dir, "relay.key")
    saved = []
    agent.save_config = saved.append  # never touch the real config.json

    def relay_answering(honest):
        def urlopen(req):
            nonce = json.loads(req.data)["nonce"]
            assert len(nonce) >= 32
            key = relay_key.encode() if honest else b"squatter guess"
            return FakeResponse({"device_id": "d1", "secret_key": "s1", "proof": agent.pairing_proof(key, nonce, "d1", "s1")})
        return urlopen

    agent.urllib.request.urlopen = relay_answering(honest=True)
    assert agent.pair_device("123456", "PC") and saved[-1]["secret_key"] == "s1"

    # A squatter on port 8000 can't prove the key, so nothing it hands back is saved
    saved.clear()
    agent.urllib.request.urlopen = relay_answering(honest=False)
    assert not agent.pair_device("123456", "PC") and saved == []

    # No relay key yet (the relay never ran as this user): refuse before sending anything
    def must_not_send(req):
        raise AssertionError("pairing request sent without a relay key")
    agent.urllib.request.urlopen = must_not_send
    agent.RELAY_KEY_FILE = os.path.join(key_dir, "missing.key")
    assert not agent.pair_device("123456", "PC") and saved == []


asyncio.run(main())
