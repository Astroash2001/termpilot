# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One developer (the author), using their own phone while away from the desk. The PC at home or the office runs anything in its terminal: a shell task, a build, a server, or a long coding-agent session (Claude Code, Codex, Gemini CLI, Aider, Antigravity `agy`); the phone is how they keep an eye on it and steer it.

## Product Purpose

TermPilot mirrors a live PowerShell session from the user's Windows PC to their phone browser, so they can run, watch, and steer anything in it without walking back to the computer. Success: the user can glance at the phone, see whether it is connected to the PC and what the terminal shows, and answer it in a few taps or a spoken prompt.

## Positioning

It is not a generic SSH client. It mirrors the exact ConPTY session already running on the PC (same columns, same in-place agent redraws), with the phone tuned for terminal work: prompt box with voice dictation, a slash-command sheet for whichever coding agent is running, a done-chime when a run finishes.

## Operating Context

- Phone browser (mobile-first), reached over an ngrok HTTPS tunnel or locally.
- Used in short glances between other activities: on the move, outdoors, in another room, often one-handed.
- The PC side is a desktop agent (`desktop-agent/agent.py`) relaying through a FastAPI backend (`backend/main.py`).
- Long runs: the user starts a task, leaves, and checks back.

## Capabilities and Constraints

Core jobs, in priority order (confirmed):
1. Watch long runs (commands or agents): read output, get the completion chime and haptic.
2. Send input: typed or dictated (Web Speech API), slash commands for the running agent.
3. Drive the terminal: key row (/ CMD, TAB, ESC, ^C, CLR, arrows).

Also present: copy terminal text or the last response, command history (swipe or arrows), text-size zoom, sound toggle, features guide.

Constraints:
- The terminal grid is pinned to the PC's PTY column count; the phone must never wrap differently from the PTY. Font size scales to fit, columns never change.
- xterm.js renders the terminal; the surrounding UI is plain HTML/CSS/JS served by the backend, no build step.
- Access is gated by an access key (unlock screen) and the PC agent pairs with a 6-digit code.

## Brand Commitments

Name: TermPilot. No visual commitments; the current look may be replaced entirely (confirmed).

## Evidence on Hand

No testimonials, users, or metrics exist. Do not invent any.

## Product Principles

1. Status at a glance: whether the phone is connected to the PC must read in under a second; the terminal itself shows the run.
2. The terminal is the truth; the chrome around it serves it and never crowds it.
3. One-handed, interrupted use: primary actions within thumb reach, nothing that needs precision tapping.
4. Fidelity to the PC session over phone-native reflow.
