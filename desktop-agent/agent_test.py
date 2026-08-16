import asyncio
import sys
import websockets

# 1. Function to run a PowerShell command and print live line-by-line output
async def execute_powershell_command(command: str):
    print(f"\n⚡ Spawning PowerShell subprocess for command: '{command}'...\n")

    # Launch powershell.exe as an asynchronous child process
    # -NoProfile: Starts faster without loading user profiles
    # -Command: Tells powershell to execute the string and exit
    process = await asyncio.create_subprocess_exec(
        "powershell.exe", "-NoProfile", "-Command", command,
        stdout=asyncio.subprocess.PIPE,  # Capture standard output3
        stderr=asyncio.subprocess.PIPE   # Capture error output
    )

    print("--- [POWERSHELL OUTPUT START] ---")

    # Read lines from standard output as PowerShell generates them
    while True:
        line = await process.stdout.readline()
        if not line:
            break  # Output stream finished
        
        # Decode bytes to readable string text
        text_line = line.decode('utf-8', errors='replace').rstrip()
        print(f"[STDOUT]: {text_line}")

    # Wait for process to complete and get exit code (0 = Success)
    exit_code = await process.wait()
    print("--- [POWERSHELL OUTPUT END] ---")
    print(f"\n✅ Process finished with Exit Code: {exit_code}\n")


# 2. Main Agent routine connecting to our Backend WebSocket
async def main():
    server_ws_url = "ws://localhost:8000/ws/echo"
    print(f"Connecting Agent to Relay Server at {server_ws_url}...")

    # Open persistent WebSocket connection to server
    async with websockets.connect(server_ws_url) as ws:
        print("🟢 Desktop Agent connected to Backend Relay!")

        # Send a hello handshake message
        await ws.send("Hello from Windows Desktop Agent!")
        response = await ws.recv()
        print(f"Server replied: {response}")

        # Now let's execute a PowerShell command locally to prove process control works!
        test_cmd = "Get-Date; Get-Location"
        await execute_powershell_command(test_cmd)

if __name__ == "__main__":
    asyncio.run(main())
