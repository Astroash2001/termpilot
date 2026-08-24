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

## 🏗️ Architecture

```mermaid
graph TD
    A["📱 Phone Web Client (xterm.js + Mobile UI)"] <-->|"WebSocket /ws/client"| B["🌐 FastAPI Relay Server (main.py)"]
    B <-->|"WebSocket /ws/agent"| C["💻 Desktop Agent (agent.py)"]
    C <-->|"winpty PTY Stream"| D["⚡ PowerShell / Antigravity CLI (agy)"]
```

* **`backend/`**: FastAPI relay server managing bidirectional WebSockets, 6-digit device pairing authentication, static caching headers, and automatic ngrok tunneling.
* **`desktop-agent/`**: Python bridge using `winpty.PtyProcess` to maintain a persistent Windows PowerShell session with bidirectional terminal streaming.
* **`web/`**: Mobile web application featuring `xterm.js`, Web Speech API dictation, touch gestures, and a dark neon cyberpunk design.

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
