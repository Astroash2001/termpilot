"""Self-check for the agent/relay handshake. Run: venv\\Scripts\\python.exe test_relay_auth.py"""
import asyncio
import json

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
    print("relay auth: all checks passed")


asyncio.run(main())
