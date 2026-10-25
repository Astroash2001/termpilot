# 🚀 TermPilot

> **Your PC's terminal, on your phone**

TermPilot puts your Windows PC's coding agents and its live terminal on your phone. One app replaces each agent's own remote app: start Claude Code, Codex or Gemini CLI as a **chat** (replies, tool steps, diffs, Allow / Deny), or open the **terminal** to run anything you would run at the desk (shell commands, scripts, builds, servers, Aider, Antigravity `agy`), watch the output, and steer it by typing, voice or a touch key row, from anywhere.

## 💬 Chats with coding agents

The phone opens to a list of chats. **New chat** picks an agent and a folder on the PC; the agent then runs there in the background while you follow it on the phone, the way the agents' own mobile apps work.

* The PC agent drives each coding agent through the [Agent Client Protocol](https://agentclientprotocol.com) (`desktop-agent/acp_host.py`), so every agent shows up the same way: Markdown replies, one line per tool step, diffs for edits, and permission questions answered with the agent's own options.
* Modes that approve every tool without asking (`bypassPermissions`, `yolo`) are never offered on the phone.
* Chats survive a dropped connection, a locked phone and a relay restart; after a PC agent restart they reopen with the agent's own history.
* **Handoff between PC and phone** (like Happy): in the TermPilot terminal type `tp claude` instead of `claude`. Claude runs there as usual and appears in the phone's chat list as *In PC terminal*. **Take over** on the phone closes it on the PC and continues the same session as a chat, with its history; press Enter in the PC terminal (or **Give back to PC** on the phone) and it resumes there with everything said on the phone. Claude Code only for now: Codex picks its own session ids.
* Setup, once: `npm ci --prefix desktop-agent/acp --ignore-scripts` installs the pinned Claude Code and Codex adapters. Gemini CLI speaks the protocol itself (`gemini --acp`). Each agent uses the login it already has on the PC.

---

## ⚡ Key Features

* **🎙️ Voice Dictation (Speech-to-Text)**: Live speech-to-text transcription with real-time text tracking.
* **📱 100% Native Mobile Kinetic Scroll**: Hardware-accelerated GPU momentum scrolling with zero drag and boundary containment.
* **⚡ Agent Slash Commands**: When a coding agent is running, `/` opens a searchable sheet of its commands (Claude Code, Codex, Gemini CLI, Aider, Antigravity).
* **📜 Smart Command History & Gestures**: Swipe left/right across the prompt box or tap `▲` / `▼` to cycle through recent prompts stored in `localStorage`.
* **📋 Native Mobile Long-Press Text Selection**: Long-press on the terminal to select text with blue pins, magnifying loupe, and native Copy/Share menus or 1-tap quick copy.
* **🔔 Task Completion Audio Alert**: Web Audio API synthesized melodic chime (`C5 -> G5`) automatically triggers when a long-running command finishes.
* **📳 Haptic Tactile Feedback**: Subtle vibration feedback on button presses, mic activation, swipe history navigation, and command execution.
* **🔒 Secure WebSocket Relay & Pairing**: 6-digit one-time token pairing and local network / ngrok tunneling.

---

## 🏗️ Comprehensive System Architecture & Execution Flow

```mermaid
graph TB
    subgraph S1["[STEP 1] 🌐 Relay Server Startup & Tunneling (backend/)"]
        direction TB
        HTTPRoutes["📡 HTTP REST Endpoints<br/>• /api/pairing/create (6-Digit OTP)<br/>• /api/pairing/verify (Device Auth)<br/>• Static Web Assets Server"]
        Tunnel["🚇 ngrok Tunnel Engine<br/>• Auto-Provisioned HTTPS Public URL<br/>• Secure Encrypted 5G/LTE Tunnel"]
        WSManager["⚡ Connection & Buffer Manager<br/>• /ws/client (Client WebSockets)<br/>• /ws/agent (Authenticated Agent WS)<br/>• 100KB Scrollback History Ring Buffer<br/>• PTY Dimension Caching & Relay"]
        DeviceStore[("💾 devices.json<br/>Registered Device Store")]
    end

    subgraph S2["[STEP 2 & 3] 💻 Desktop Agent Bridge (desktop-agent/)"]
        direction TB
        AuthModule["🔑 Pairing & Auth Handler<br/>• 6-Digit OTP Handshake<br/>• config.json Device Keys"]
        PTYEngine["⚙️ winpty Session Controller<br/>• Persistent PtyProcess Spawn<br/>• clean_pty_output ANSI DA Filter<br/>• Bidirectional WS Event Loop"]
        ConsoleSync["📐 Local Console Monitor<br/>• Native Window Size Tracker<br/>• Host Keyboard Input Thread"]
        Flusher["🧹 Startup Buffer Flusher<br/>• PSReadLine Input Drainer<br/>• Screen State Initializer"]
    end

    subgraph S3["[STEP 4 & 6] 📱 Mobile & Web Client (web/)"]
        direction TB
        UI["🖥️ UI Components<br/>• Auto-Growing Prompt Box<br/>• Mobile Touch Bar (^C, ESC, CLR, Arrows)<br/>• Quick Action Snippets Bar<br/>• 40+ Slash Commands Modal<br/>• Features Guide & Plaintext Copy Sheet"]
        VoiceEngine["🎙️ Web Speech API Engine<br/>• Continuous Dictation & Text Tracking<br/>• Non-Destructive Speech Appending"]
        Terminal["📟 xterm.js Terminal Engine<br/>• GPU-Accelerated WebGL/Canvas<br/>• Dynamic PTY Dimension Scaling<br/>• Zero-Drag Momentum Scrolling"]
        Feedback["🔔 Feedback System<br/>• Web Audio API Synthesized Chime<br/>• Tactile Vibration Haptics"]
    end

    subgraph S4["[STEP 5] ⚡ Host System & Execution Environment"]
        direction TB
        Shell["🐚 Windows PowerShell (5.1 / 7+)<br/>Native Environment & PATH Tools"]
        AgyCLI["🤖 Any CLI program<br/>• Scripts, builds, servers<br/>• Coding agents (Claude Code, Codex, Gemini CLI, Aider, agy)<br/>• Full-screen apps and in-place redraws"]
        DevTools["🛠️ Developer CLI Stack<br/>• Git, Python, Node.js, npm, compilers"]
    end

    %% Step 1: Startup
    HTTPRoutes <-->|1. Validate Registered Keys| DeviceStore
    Tunnel -->|1. Expose HTTPS URL| HTTPRoutes
    Tunnel -->|1. Expose WSS Gateway| WSManager

    %% Step 2: Pairing & Handshake
    UI -.->|"2. Request 6-Digit Code"| HTTPRoutes
    AuthModule -.->|"2. Verify Token & Handshake"| HTTPRoutes

    %% Step 3: Agent Connect & PTY Spawn
    PTYEngine <-->|"3. Authenticated WS (/ws/agent)"| WSManager
    ConsoleSync -->|"3. Broadcast PTY_SIZE"| WSManager
    Flusher -->|"3. Clean Buffer"| PTYEngine
    PTYEngine <-->|"3. Win32 Pseudo-Console Pipe"| Shell

    %% Step 4: Client Connect & User Input
    WSManager -->|"4. Replay 100KB Scrollback & PTY_SIZE"| Terminal
    VoiceEngine -->|"4. Dictate & Append Text"| UI
    UI -->|"4. Send Keystrokes / Commands"| Terminal
    Terminal -->|"4. Send JSON {type: 'INPUT'}"| WSManager
    WSManager -->|"4. Forward Input"| PTYEngine

    %% Step 5: Execution
    PTYEngine -->|"5. Write to PTY Pipe"| Shell
    Shell <-->|"5. Interactive Programs"| AgyCLI
    Shell <-->|"5. Run System Subprocesses"| DevTools

    %% Step 6: Output & Feedback
    Shell -->|"6. Terminal Output"| PTYEngine
    PTYEngine -->|"6. Filter DA Codes & Stream RAW"| WSManager
    WSManager -->|"6. Broadcast RAW Stream"| Terminal
    Terminal -->|"6. Trigger Completion Chime & Haptic"| Feedback
```

---

### 🗺️ Step-by-Step Operational Lifecycle

| Step | Stage | What Happens |
| :--- | :--- | :--- |
| **`STEP 1`** | **Relay Startup** | `python main.py` starts the FastAPI backend, mounts static web assets, loads `devices.json`, provisions the public `ngrok` HTTPS tunnel, and initializes the 100KB rolling scrollback buffer. |
| **`STEP 2`** | **Device Pairing** | On first use, the mobile client requests a 6-digit OTP code. The desktop agent verifies the code via `python agent.py --pair <code>`, receiving an authenticated `device_id` and `secret_key` saved to `config.json`. |
| **`STEP 3`** | **PTY Session Spawn** | Desktop agent connects to `/ws/agent`, spawns a persistent PowerShell session using `winpty`, drains initial probe codes, and broadcasts native console dimensions (`PTY_SIZE`). |
| **`STEP 4`** | **Mobile Connect & Input** | Mobile client connects to `/ws/client`, immediately receives replayed scrollback history, dynamically scales font size to match `PTY_SIZE`, and sends typed, spoken (`🎙️`), or touch-bar (`▲`, `▼`, `⌃C`) commands as `{type: "INPUT"}` JSON payloads. |
| **`STEP 5`** | **Execution** | Input is piped to the persistent Win32 ConPTY. PowerShell and whatever it starts (scripts, builds, coding agents, full-screen apps) run exactly as they would at the desk. |
| **`STEP 6`** | **Output Stream & Feedback** | PTY output is filtered for device attribute artifacts and streamed over WebSocket to `xterm.js`. Upon command completion, a melodic Web Audio chime triggers and tactile haptic vibrations pulse. |

---

## 🚀 Quick Start

### 1. Prerequisites
* Python 3.10+
* Node.js and the agents you want to chat with (Claude Code, Codex, Gemini CLI), then `npm ci --prefix desktop-agent/acp --ignore-scripts`
* (Optional) `ngrok` for public remote phone access over 5G/LTE

### 2. Start the Backend Relay
```bash
cd backend
pip install -r requirements.txt
python main.py
```

### 3. Connect the Desktop Agent
```bash
cd desktop-agent
pip install -r requirements.txt
python agent.py
```
*(If pairing for the first time, run `python agent.py --pair <6-digit-code>` shown on your phone screen).*

### 4. Open on Mobile
Navigate to the local or ngrok HTTPS URL on your phone's browser, tap the **`💡 FEATURES`** button to view available shortcuts, and start coding on the go!

---

## 📄 License
MIT License. Created by [Astroash2001](https://github.com/Astroash2001).
