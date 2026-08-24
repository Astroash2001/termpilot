# 🚀 TermPilot

> **Next-Gen Mobile Terminal Companion & Remote AI Agent Controller**

TermPilot is a low-latency, mobile-first terminal interface and relay pipeline designed to let developers seamlessly monitor, execute commands, dictating prompts via voice, and control AI coding assistants (like Google Antigravity `agy`) directly from their smartphones with a native app feel.

---

## ⚡ Key Features

* **🎙️ Voice Dictation (Speech-to-Text)**: Live speech-to-text transcription with real-time text tracking.
* **📱 100% Native Mobile Kinetic Scroll**: Hardware-accelerated GPU momentum scrolling with zero drag and boundary containment.
* **⚡ 40+ Antigravity Slash Commands**: Full interactive modal with instant search and 1-tap execution for `/plan`, `/goal`, `/mcp`, `/skills`, etc.
* **📜 Smart Command History & Gestures**: Swipe left/right across the prompt box or tap `▲` / `▼` to cycle through recent prompts stored in `localStorage`.
* **🚀 Quick Action Snippets Bar**: 1-tap pills for `git status`, `git diff`, `dir`, `python`, plus `+ Add` to save custom command pins permanently.
* **📋 Native Mobile Long-Press Text Selection**: Long-press on the terminal to select text with blue pins, magnifying loupe, and native Copy/Share menus or 1-tap quick copy.
* **🔔 Task Completion Audio Alert**: Web Audio API synthesized melodic chime (`C5 -> G5`) automatically triggers when long-running AI tasks finish.
* **📳 Haptic Tactile Feedback**: Subtle vibration feedback on button presses, mic activation, swipe history navigation, and command execution.
* **🔒 Secure WebSocket Relay & Pairing**: 6-digit one-time token pairing and local network / ngrok tunneling.

---

## 🏗️ Comprehensive System Architecture

```mermaid
graph TB
    subgraph Client["📱 Frontend Client (web/)"]
        direction TB
        UI["🖥️ UI Components<br/>• Auto-Growing Prompt Box<br/>• Mobile Touch Bar (^C, ESC, CLR, Arrows)<br/>• Quick Action Snippets Bar<br/>• 40+ Slash Commands Modal<br/>• Features Guide & Plaintext Copy Sheet"]
        Terminal["📟 xterm.js Terminal Engine<br/>• GPU-Accelerated WebGL/Canvas<br/>• Dynamic PTY Dimension Scaling<br/>• Zero-Drag Momentum Scrolling"]
        VoiceEngine["🎙️ Web Speech API Engine<br/>• Continuous Dictation & Text Tracking<br/>• Non-Destructive Speech Appending"]
        Feedback["🔔 Feedback System<br/>• Web Audio API Synthesized Chime<br/>• Tactile Vibration Haptics"]
    end

    subgraph RelayServer["🌐 FastAPI Relay Backend (backend/)"]
        direction TB
        HTTPRoutes["📡 HTTP REST Endpoints<br/>• /api/pairing/create (6-Digit OTP)<br/>• /api/pairing/verify (Device Auth)<br/>• Static UI Server (HTML/CSS/JS)"]
        Tunnel["🚇 ngrok Tunneling Service<br/>• Auto-Provisioned HTTPS Public URL<br/>• Encrypted LTE/5G Mobile Access"]
        WSManager["⚡ Connection & Buffer Manager<br/>• /ws/client (Client WebSockets)<br/>• /ws/agent (Authenticated Agent WS)<br/>• 100KB Rolling Scrollback Buffer<br/>• PTY Dimension Relay & Broadcasting"]
        DeviceStore[("💾 devices.json<br/>Registered Device Keys")]
    end

    subgraph Agent["💻 Desktop Agent Bridge (desktop-agent/)"]
        direction TB
        AuthModule["🔑 Pairing & Auth Handler<br/>• Token Verification<br/>• config.json Device Credentials"]
        PTYEngine["⚙️ winpty Session Controller<br/>• Persistent PtyProcess Engine<br/>• clean_pty_output DA/CPR Probe Filter<br/>• Async WebSocket Event Loop"]
        ConsoleSync["📐 Local Console Monitor<br/>• Dynamic Window Size Tracker<br/>• Host Keyboard Input Thread"]
        Flusher["🧹 Startup Buffer Flusher<br/>• PSReadLine Input Drainer<br/>• Screen State Initializer"]
    end

    subgraph Environment["⚡ Host System & Execution Environment"]
        direction TB
        Shell["🐚 Windows PowerShell (5.1 / 7+)<br/>Native Environment & PATH Tools"]
        AgyCLI["🤖 Google Antigravity (agy)<br/>• Interactive Session & Model Selectors<br/>• Multi-Agent Coordination (/goal, /plan)<br/>• Dynamic In-Place ANSI Redraws"]
        DevTools["🛠️ Developer CLI Stack<br/>• Git, Python, Node.js, npm, compilers"]
    end

    %% Client Interactions
    UI -->|User Input & Keystrokes| Terminal
    VoiceEngine -->|Dictated Prompts| UI
    Terminal -->|"JSON Payload: {type: 'INPUT'}"| WSManager
    WSManager -->|"JSON Stream: {type: 'RAW', 'PTY_SIZE'}"| Terminal
    Terminal -->|Task Finished Signal| Feedback

    %% Relay Server Internals
    HTTPRoutes <-->|Store & Validate Auth| DeviceStore
    HTTPRoutes --- WSManager
    Tunnel -->|HTTPS Proxy| HTTPRoutes
    Tunnel -->|WSS Proxy| WSManager

    %% Agent Interactions
    WSManager <-->|"Bi-directional WebSocket (/ws/agent)"| PTYEngine
    AuthModule -->|Device Handshake| HTTPRoutes
    ConsoleSync -->|"Window Resize Signals (PTY_SIZE)"| WSManager
    ConsoleSync -->|Direct setwinsize| PTYEngine
    Flusher -->|Startup Sequence| PTYEngine

    %% PTY to Shell Execution
    PTYEngine <-->|"Win32 Pseudo-Console Pipe"| Shell
    Shell <-->|Command Execution| AgyCLI
    Shell <-->|Subprocesses| DevTools
```

* **`web/`**: Mobile-first cyberpunk web app powered by `xterm.js`, Web Speech API voice transcription, kinetic touch scrolling, and dynamic layout scaling.
* **`backend/`**: FastAPI relay server managing bidirectional WebSockets, 6-digit device pairing authentication, rolling scrollback history replay, static asset caching, and automated ngrok tunneling.
* **`desktop-agent/`**: Python bridge maintaining a persistent `winpty` PowerShell session, host terminal window size synchronization, and ANSI device attribute probe filtering.
* **`Target System`**: Full interactive PowerShell environment hosting the Google Antigravity CLI (`agy`), AI orchestration loops, and developer tooling.

---

## 🚀 Quick Start

### 1. Prerequisites
* Python 3.10+
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
