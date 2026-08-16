import json
import asyncio
import sys
import websockets

async def start_client():
    server_url = "ws://localhost:8000/ws/client"
    print(f"Connecting Mobile/Web Client to Relay Server at {server_url}...")

    async with websockets.connect(server_url) as ws:
        print("📱 Mobile Client Connected! You can now send commands to your computer.\n")

        # Async task to receive live streaming lines from Desktop Agent
        async def listen_for_output():
            while True:
                message_text = await ws.recv()
                payload = json.loads(message_text)
                
                msg_type = payload.get("type")
                data = payload.get("data", "")
                
                if msg_type == "STDOUT":
                    print(f"\033[92m{data}\033[0m", end="")  # Green text for normal output
                elif msg_type == "STDERR":
                    print(f"\033[91m{data}\033[0m", end="")  # Red text for error output
                elif msg_type == "COMMAND_COMPLETED":
                    exit_code = payload.get("exit_code")
                    print(f"\n\033[94m[Process Completed with Exit Code {exit_code}]\033[0m\n")

        # Start listening task in background
        asyncio.create_task(listen_for_output())

        # Interactive loop prompting user for commands
        while True:
            cmd = await asyncio.get_event_loop().run_in_executor(None, input, "TermPilot > ")
            if cmd.strip().lower() == "exit":
                print("Exiting Client...")
                break
            if cmd.strip():
                # Send command payload over WebSocket to Relay Server
                await ws.send(json.dumps({"command": cmd}))
                await asyncio.sleep(0.5)

if __name__ == "__main__":
    asyncio.run(start_client())
