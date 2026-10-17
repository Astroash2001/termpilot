// ── Terminal Setup ──────────────────────────────────────────────────────

function getSavedOrOptimalFontSize() {
  try {
    const saved = localStorage.getItem('termpilot_font_size');
    if (saved) {
      const parsed = parseFloat(saved);
      if (parsed >= 8 && parsed <= 24) return parsed;
    }
  } catch (e) {}

  const w = window.innerWidth || document.documentElement.clientWidth || 400;
  // On mobile (< 500px), use 10px so 75-80 columns fit across the full screen without clipping text descriptions
  if (w < 420) return 9.5;
  if (w < 600) return 10.5;
  if (w < 900) return 12;
  return 13;
}

let currentFontSize = getSavedOrOptimalFontSize();

const term = new Terminal({
  cursorBlink: true,
  cursorStyle: 'block',
  fontSize: currentFontSize,
  fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Roboto Mono", monospace',
  // Field Book graphite pane. ANSI hues are tuned to stay readable on it: dim text
  // (brightBlack) holds ~4.9:1, because agents print a lot of it.
  theme: {
    background: '#1c1e19',
    foreground: '#e4e0d2',
    cursor: '#7aa2ff', // blue pencil: the cursor is not a pressable
    cursorAccent: '#1c1e19',
    selectionBackground: 'rgba(122, 162, 255, 0.35)',
    black: '#24271f',
    red: '#e8735f',
    green: '#9cc27f',
    yellow: '#f2c230',
    blue: '#86a9cf',
    magenta: '#c995bd',
    cyan: '#86c4b5',
    white: '#d9d6c8',
    brightBlack: '#8e8b7c',
    brightRed: '#f29a88',
    brightGreen: '#b8d79f',
    brightYellow: '#f7d66b',
    brightBlue: '#a9c3e0',
    brightMagenta: '#ddb4d3',
    brightCyan: '#a8d8cc',
    brightWhite: '#f5f1e4',
  },
  scrollback: 10000,
  allowProposedApi: true,
  disableStdin: true, // Display-only. All input via native <textarea>.
  smoothScrollDuration: 0, // Disables software animation conflict so native OS momentum glides freely
  scrollSensitivity: 1,
  fastScrollSensitivity: 1,
});

const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);

const xtermContainer = document.getElementById('xterm-container');
term.open(xtermContainer);

// WebGL for smooth rendering (optional, graceful fallback)
try {
  const webglAddon = new WebglAddon.WebglAddon();
  webglAddon.onContextLoss(() => webglAddon.dispose());
  term.loadAddon(webglAddon);
} catch (e) {
  console.warn("WebGL failed, using canvas renderer", e);
}

// ── DOM Elements ────────────────────────────────────────────────────────

const overlay = document.getElementById("connection-overlay");
const statusText = document.getElementById("status-text");
const btnPair = document.getElementById("btn-pair");
const pairingDisplay = document.getElementById("pairing-display");
const pairingCodeBox = document.getElementById("pairing-code-box");
const pairingCmdHint = document.getElementById("pairing-cmd-hint");
const mobileInput = document.getElementById("mobile-input");
const btnSend = document.getElementById("btn-send");
const btnMic = document.getElementById("btn-mic");
const commandsModal = document.getElementById("commands-modal");
const btnCommands = document.getElementById("btn-commands");
const btnCloseModal = document.getElementById("btn-close-modal");

// ── WebSocket ───────────────────────────────────────────────────────────

const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const WS_URL = `${wsProtocol}//${window.location.host}/ws/client`;

// ── Access Key ──────────────────────────────────────────────────────────
// The server rejects any WebSocket that doesn't open with this key. It arrives once via
// the link the server prints (#key=...; fragments never leave the browser) or by hand,
// then lives in localStorage.
const ACCESS_KEY_STORAGE = "termpilot_access_key";
const authSection = document.getElementById("auth-section");
const pairingSection = document.getElementById("pairing-section");
const accessKeyInput = document.getElementById("access-key-input");

function getAccessKey() {
  try { return localStorage.getItem(ACCESS_KEY_STORAGE) || ""; } catch (e) { return ""; }
}

function setAccessKey(key) {
  try {
    if (key) localStorage.setItem(ACCESS_KEY_STORAGE, key);
    else localStorage.removeItem(ACCESS_KEY_STORAGE);
  } catch (e) {}
}

(function captureKeyFromLink() {
  const m = window.location.hash.match(/[#&]key=([^&]+)/);
  if (!m) return;
  setAccessKey(decodeURIComponent(m[1]));
  // Drop it from the address bar and history so it isn't shared by accident
  history.replaceState(null, "", window.location.pathname + window.location.search);
})();

function showAccessKeyPrompt() {
  setConnected(false);
  authSection.style.display = "block";
  pairingSection.style.display = "none";
  statusText.textContent = "LOCKED";
  statusText.dataset.state = "locked";
  setStamp("locked", "LOCKED");
  runMeta.textContent = "key needed";
}

document.getElementById("btn-access-key").addEventListener("click", () => {
  const key = accessKeyInput.value.trim();
  if (!key) return;
  setAccessKey(key);
  accessKeyInput.value = "";
  authSection.style.display = "none";
  pairingSection.style.display = "";
  connect();
});
// ── Dynamic PTY Dimension Sync & Responsive Scaling ───────────────────

let ptyCols = 0;
let ptyRows = 0;

// Must match the Terminal fontFamily above: the cell width is measured from it
const TERM_FONT_FAMILY = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Roboto Mono", monospace';

// Cell width scales linearly with font size, so measure the real advance width once and
// derive the rest. A guessed ratio drifts from the actual font metric and leaves the
// terminal a column or two off the PTY, which is enough to break redraws.
let charWidthRatio = null;
function getCharWidthRatio() {
  if (charWidthRatio) return charWidthRatio;
  try {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;' +
                          'font-size:100px;font-family:' + TERM_FONT_FAMILY;
    probe.textContent = '0'.repeat(100);
    document.body.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 100 / 100;
    probe.remove();
    if (w > 0) charWidthRatio = w;
  } catch (e) {}
  return charWidthRatio || 0.605;
}

// Manual text-size control. This scales the FONT only - never the column count, which
// stays pinned to ptyCols below. Zooming by changing columns would make the phone wrap
// lines the PTY never wrapped and bring the duplicated-menu bug straight back.
const ZOOM_MIN = 0.6, ZOOM_MAX = 2.6, ZOOM_STEP = 0.15;
let termZoom = 1.0;
try {
  const savedZoom = parseFloat(localStorage.getItem('termpilot_zoom'));
  if (savedZoom >= ZOOM_MIN && savedZoom <= ZOOM_MAX) termZoom = savedZoom;
} catch (e) {}

window.adjustTerminalZoom = function(dir) {
  triggerHaptic(12);
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, termZoom + dir * ZOOM_STEP));
  if (Math.abs(next - termZoom) < 0.001) return;
  termZoom = next;
  try { localStorage.setItem('termpilot_zoom', String(termZoom)); } catch (e) {}
  adaptFontSizeToPty();
  paintZoomReadout();
};

// Live readout between A− and A+, so the size is visible without a toast
function paintZoomReadout() {
  const el = document.getElementById("zoom-readout");
  if (el) el.textContent = Math.round(termZoom * 100) + "%";
}
paintZoomReadout();

function adaptFontSizeToPty() {
  const container = document.getElementById('xterm-container');
  if (!container) return;
  const availableWidth = container.clientWidth || window.innerWidth || 400;

  // Past 1x the grid is wider than the screen, so let the wrapper pan horizontally.
  // At 1x this class is absent and the layout is byte-for-byte what it was before.
  container.classList.toggle('zoomed', termZoom > 1.001);

  if (ptyCols && ptyCols >= 20) {
    // 1. Size the font so all ptyCols fit across the screen. No comfort floor here: a
    // terminal showing fewer columns than the PTY wraps lines the PTY never wrapped, so
    // an app that repaints by moving the cursor up N lines lands short of its old output
    // and leaves a duplicate copy behind on every redraw.
    const widthBasedSize = (availableWidth - 8) / (ptyCols * getCharWidthRatio());
    const baseSize = Math.max(4.0, Math.min(15.5, widthBasedSize));
    const clampedSize = Math.max(4.0, Math.min(40, baseSize * termZoom));
    if (Math.abs(term.options.fontSize - clampedSize) > 0.1) {
      term.options.fontSize = clampedSize;
    }
  }

  // 2. Fill 100% of vertical container height cleanly without dead zones or empty black blocks
  try {
    fitAddon.fit();
    // fit() derives columns from the container, which can still land a column or two off.
    // Wrapping must match the PTY exactly, so pin the columns and keep the fitted rows.
    if (ptyCols && ptyCols >= 20 && term.cols !== ptyCols) {
      term.resize(ptyCols, term.rows);
    }
  } catch (e) {}
}

// ── Run Entry (the cover band) ──────────────────────────────────────────
// Answers "is it working, done, or stuck?" in one glance: a stamp, what was sent,
// the elapsed time, and a ruled line that fills over an hour.

const runStamp = document.getElementById("run-stamp");
const runPrompt = document.getElementById("run-prompt");
const runMeta = document.getElementById("run-meta");
const runClock = document.getElementById("run-clock");
const runRule = document.getElementById("run-rule");
const RUN_RULE_FULL_MS = 60 * 60 * 1000;

let runStartedAt = 0;
let runEndedAt = 0;
let runTimer = null;
let runChimes = true;
let runCount = 0; // entries are numbered for the session, like a field book

function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

function clockTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function setStamp(state, label) {
  if (runStamp.dataset.state === state && runStamp.textContent === label) return;
  runStamp.dataset.state = state;
  runStamp.textContent = label;
  // A rubber stamp never lands at quite the same angle twice
  runStamp.style.setProperty("--tilt", (-3 + Math.random() * 2).toFixed(2) + "deg");
  // Restart the press-in animation for every new state
  runStamp.classList.remove("pressed");
  void runStamp.offsetWidth;
  runStamp.classList.add("pressed");
}

function paintRunClock() {
  if (!runStartedAt) {
    runClock.textContent = "--:--";
    runRule.style.transform = "scaleX(0)";
    return;
  }
  const elapsed = (runEndedAt || Date.now()) - runStartedAt;
  runClock.textContent = formatElapsed(elapsed);
  runRule.style.transform = `scaleX(${Math.min(elapsed / RUN_RULE_FULL_MS, 1)})`;
}

function startRun(label, { chime = true } = {}) {
  runStartedAt = Date.now();
  runCount += 1;
  runEndedAt = 0;
  runChimes = chime;
  runPrompt.textContent = label;
  runMeta.textContent = `No. ${runCount} · ${clockTime(runStartedAt)}`;
  setStamp("running", "RUNNING");
  clearInterval(runTimer);
  runTimer = setInterval(paintRunClock, 1000);
  paintRunClock();
}

function finishRun() {
  if (!runStartedAt || runEndedAt) return;
  runEndedAt = Date.now();
  clearInterval(runTimer);
  paintRunClock();
  // The frozen clock already shows how long it took
  runMeta.textContent = "finished " + clockTime(runEndedAt);
  setStamp("done", "DONE");
}

// Stop the clock without claiming success (agent dropped, connection lost)
function abandonRun(reason) {
  isCommandRunning = false;
  if (runStartedAt && !runEndedAt) {
    runEndedAt = Date.now();
    clearInterval(runTimer);
    paintRunClock();
  }
  runMeta.textContent = reason;
}

// True when the line under the cursor is a bare PowerShell prompt ("PS C:\path>")
function terminalShowsPrompt() {
  const buf = term.buffer.active;
  const line = buf.getLine(buf.baseY + buf.cursorY);
  return !!line && /^PS [A-Za-z]:\\.*>$/.test(line.translateToString(true));
}

// Called after output lands and once shortly after each send. The 3s guard skips the
// echo of the command itself, which also starts with "PS ".
function checkRunComplete(chunk = "") {
  if (!isCommandRunning || performance.now() - lastCommandTime <= 3000) return;
  const chunkSaysDone = chunk.includes("PS ") || chunk.includes("> ") || chunk.includes("? for shortcuts");
  if (!chunkSaysDone && !terminalShowsPrompt()) return;
  isCommandRunning = false;
  finishRun();
  if (runChimes) {
    playCompletionChime();
    triggerHaptic([25, 40, 25]);
  }
}

function setConnected(on) {
  if (on) {
    overlay.style.display = "none";
    if (!runStartedAt) {
      setStamp("ready", "READY");
      runMeta.textContent = "connected";
    } else if (runEndedAt && runStamp.dataset.state === "offline") {
      setStamp("ready", "READY");
    }
    setTimeout(adaptFontSizeToPty, 50);
    setTimeout(adaptFontSizeToPty, 200);
  } else {
    overlay.style.display = "flex";
    statusText.textContent = "OFFLINE";
    statusText.dataset.state = "offline";
    setStamp("offline", "OFFLINE");
    abandonRun("relay lost");
  }
}

function connect() {
  const accessKey = getAccessKey();
  if (!accessKey) {
    showAccessKeyPrompt();
    return;
  }
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "AUTH", key: accessKey }));
  };

  ws.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "AUTH_OK") {
      setConnected(true);
      adaptFontSizeToPty();
    } else if (payload.type === "RAW") {
      // Native xterm.js ANSI rendering without forced scrolling interference.
      // Completion is checked once the chunk is parsed, so the cursor line is current.
      const chunk = payload.data;
      term.write(chunk, () => checkRunComplete(chunk));
    } else if (payload.type === "PTY_SIZE") {
      ptyCols = payload.cols;
      ptyRows = payload.rows;
      adaptFontSizeToPty();
    } else if (payload.type === "STDERR") {
      // Show errors visibly in the terminal
      term.write("\r\n\x1b[31m" + payload.data + "\x1b[0m\r\n");
      if (payload.data.includes("Desktop Agent is OFFLINE")) {
        setStamp("offline", "NO PC");
        abandonRun("PC agent off");
      }
    }
  };

  ws.onclose = (event) => {
    if (event.code === 4001) {
      // Wrong or rotated key: retrying with it would only fail again
      setAccessKey("");
      showAccessKeyPrompt();
      return;
    }
    setConnected(false);
    setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    setConnected(false);
  };
}

// ── Haptic Vibration & Audio Feedback ──────────────────────────────────

function triggerHaptic(pattern = 15) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (e) {}
  }
}

let soundEnabled = true;
const btnSoundToggle = document.getElementById("btn-sound-toggle");
let audioCtx = null;

function playCompletionChime() {
  if (!soundEnabled) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    // Soothing 2-tone melodic chime (C5 -> G5)
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.12);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.4);
  } catch (e) {}
}

if (btnSoundToggle) {
  btnSoundToggle.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    btnSoundToggle.classList.toggle("muted", !soundEnabled);
    btnSoundToggle.setAttribute("aria-pressed", String(soundEnabled));
    triggerHaptic(25);
    if (soundEnabled) playCompletionChime();
  });
}

// ── Smart Command History ───────────────────────────────────────────────

let commandHistory = [];
let historyIndex = -1;

function loadCommandHistory() {
  try {
    const saved = localStorage.getItem("termpilot_history");
    if (saved) commandHistory = JSON.parse(saved);
  } catch (e) {}
}
loadCommandHistory();

function saveToHistory(cmd) {
  if (!cmd || !cmd.trim()) return;
  const trimmed = cmd.trim();
  commandHistory = commandHistory.filter(c => c !== trimmed);
  commandHistory.unshift(trimmed);
  if (commandHistory.length > 50) commandHistory.pop();
  try {
    localStorage.setItem("termpilot_history", JSON.stringify(commandHistory));
  } catch (e) {}
  historyIndex = -1;
}

window.handleHistoryNav = function(dir) {
  triggerHaptic(12);
  if (commandHistory.length === 0) return;
  if (dir === 'up') {
    if (historyIndex < commandHistory.length - 1) {
      historyIndex++;
      mobileInput.value = commandHistory[historyIndex];
      autoGrowInput();
      mobileInput.selectionStart = mobileInput.selectionEnd = mobileInput.value.length;
    }
  } else if (dir === 'down') {
    if (historyIndex > 0) {
      historyIndex--;
      mobileInput.value = commandHistory[historyIndex];
      autoGrowInput();
      mobileInput.selectionStart = mobileInput.selectionEnd = mobileInput.value.length;
    } else if (historyIndex === 0) {
      historyIndex = -1;
      mobileInput.value = "";
      autoGrowInput();
    }
  }
};

// ── Quick Snippets Bar ──────────────────────────────────────────────────

window.sendSnippet = function(cmd) {
  triggerHaptic(15);
  saveToHistory(cmd.replace(/\r$/, ''));
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "INPUT", data: cmd }));
    // Pinned commands are quick; stamp them, but keep the chime for real runs
    lastCommandTime = performance.now();
    isCommandRunning = true;
    startRun(cmd.replace(/\r$/, ''), { chime: false });
    setTimeout(checkRunComplete, 3100);
  }
};

window.promptAddSnippet = function() {
  triggerHaptic(15);
  const name = prompt("Enter custom command (e.g., 'npm test' or 'git push'):");
  if (name && name.trim()) {
    saveCustomSnippet(name.trim());
  }
};

function loadCustomSnippets() {
  try {
    const saved = localStorage.getItem("termpilot_snippets");
    if (saved) {
      const snippets = JSON.parse(saved);
      const bar = document.getElementById("snippets-bar");
      if (!bar) return;
      const addBtn = bar.querySelector(".add-snippet");
      snippets.forEach(s => {
        const btn = document.createElement("button");
        btn.className = "snippet-pill";
        btn.textContent = s;
        btn.onclick = () => sendSnippet(s + "\r");
        bar.insertBefore(btn, addBtn);
      });
    }
  } catch (e) {}
}
loadCustomSnippets();

function saveCustomSnippet(snippet) {
  try {
    let list = [];
    const saved = localStorage.getItem("termpilot_snippets");
    if (saved) list = JSON.parse(saved);
    if (!list.includes(snippet)) {
      list.push(snippet);
      localStorage.setItem("termpilot_snippets", JSON.stringify(list));
      const bar = document.getElementById("snippets-bar");
      const addBtn = bar.querySelector(".add-snippet");
      const btn = document.createElement("button");
      btn.className = "snippet-pill";
      btn.textContent = snippet;
      btn.onclick = () => sendSnippet(snippet + "\r");
      bar.insertBefore(btn, addBtn);
    }
  } catch (e) {}
}

// ── Send Command & Auto-Growing Prompt Box ──────────────────────────────

let lastCommandTime = 0;
let isCommandRunning = false;

function autoGrowInput() {
  mobileInput.style.height = 'auto';
  const newH = Math.min(Math.max(mobileInput.scrollHeight, 48), 110);
  mobileInput.style.height = newH + 'px';
  mobileInput.scrollTop = mobileInput.scrollHeight;
}

function sanitizeTerminalInput(str) {
  if (!str) return str;
  // Strip ONLY actual ANSI Device Attributes (DA1: \x1b[?...c, DA2: \x1b[>...c, CPR: \x1b[...R) probe sequences
  return str.replace(/(\x1b)?\[\?[0-9;]*c/g, '').replace(/(\x1b)?\[>[0-9;]*c/g, '').replace(/(\x1b)?\[[0-9]+;[0-9]+R/g, '');
}

function sendCommand() {
  const text = mobileInput.value;
  
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    term.write("\r\n\x1b[31mNot connected to server.\x1b[0m\r\n");
    return;
  }

  // If input is empty, sending Enter/Carriage Return selects or confirms active terminal prompt/options
  if (!text) {
    triggerHaptic(15);
    ws.send(JSON.stringify({ type: "INPUT", data: "\r" }));
    return;
  }
  
  triggerHaptic(20);
  saveToHistory(text);
  lastCommandTime = performance.now();
  isCommandRunning = true;
  startRun(text);
  // Fast commands are back at the prompt before the 3s guard ends; look once after it
  setTimeout(checkRunComplete, 3100);

  // Send the sanitized typed text + carriage return to execute
  const cleanText = sanitizeTerminalInput(text);
  ws.send(JSON.stringify({ type: "INPUT", data: cleanText + "\r" }));
  mobileInput.value = "";
  mobileInput.style.height = "48px";
  mobileInput.focus();
}

// Send button tap
btnSend.addEventListener("click", (e) => {
  e.preventDefault();
  sendCommand();
});

// Prevent mobile keyboard from scrolling the whole browser window
mobileInput.addEventListener("focus", () => {
  setTimeout(() => {
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
    term.scrollToBottom();
  }, 50);
});

mobileInput.addEventListener("blur", () => {
  setTimeout(() => {
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
    term.scrollToBottom();
  }, 50);
});

// Keyboard Enter key (Shift+Enter for newline, Enter to submit)
mobileInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendCommand();
  } else if (e.key === "ArrowUp") {
    if (mobileInput.selectionStart === 0 && mobileInput.selectionEnd === 0) {
      e.preventDefault();
      handleSmartArrowNav('up');
    }
  } else if (e.key === "ArrowDown") {
    if (mobileInput.selectionStart === mobileInput.value.length && mobileInput.selectionEnd === mobileInput.value.length) {
      e.preventDefault();
      handleSmartArrowNav('down');
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    handleEscKey();
  }
});

// ── Touch Bar ───────────────────────────────────────────────────────────

window.handleEscKey = function() {
  triggerHaptic(15);
  // 1. Close any open UI modal
  if (commandsModal && (commandsModal.style.display === "flex" || commandsModal.style.display === "block")) {
    commandsModal.style.display = "none";
    mobileInput.focus();
    return;
  }
  if (featuresModal && (featuresModal.style.display === "flex" || featuresModal.style.display === "block")) {
    featuresModal.style.display = "none";
    return;
  }
  if (selectModal && (selectModal.style.display === "flex" || selectModal.style.display === "block")) {
    selectModal.style.display = "none";
    return;
  }

  // 2. Send ANSI Escape sequence (\x1b) to PTY to exit interactive options, menus, and selection prompts
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "INPUT", data: "\x1b" }));
  }
  mobileInput.focus();
};

window.sendInput = function(sequence) {
  triggerHaptic(12);
  const clean = sanitizeTerminalInput(sequence);
  if (clean && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "INPUT", data: clean }));
  }
  mobileInput.focus();
};

// ── Resize ──────────────────────────────────────────────────────────────

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(adaptFontSizeToPty, 150);
});

new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(adaptFontSizeToPty, 150);
}).observe(xtermContainer);

// ── Voice Input (Speech-to-Text) ────────────────────────────────────────

let recognition = null;
let isListening = false;
let voiceBasePrompt = "";

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognitionAPI) {
  recognition = new SpeechRecognitionAPI();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    isListening = true;
    // Capture current prompt text so new speech appends seamlessly without erasing prior input
    voiceBasePrompt = (mobileInput.value || "").trim();
    btnMic.classList.add("listening");
    btnMic.title = "Listening... tap to stop";
  };

  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    if (transcript) {
      const cleanTranscript = transcript.trim();
      mobileInput.value = voiceBasePrompt ? `${voiceBasePrompt} ${cleanTranscript}` : cleanTranscript;
      autoGrowInput();
      // Auto-scroll to the end so newest spoken words are always visible
      mobileInput.scrollTop = mobileInput.scrollHeight;
      mobileInput.selectionStart = mobileInput.selectionEnd = mobileInput.value.length;
    }
  };

  recognition.onerror = (event) => {
    console.warn("Speech recognition error:", event.error);
    stopListening();
  };

  recognition.onend = () => {
    stopListening();
  };
}

function stopListening() {
  isListening = false;
  btnMic.classList.remove("listening");
  btnMic.title = "Voice Input";
}

function toggleListening() {
  if (!SpeechRecognitionAPI) {
    showToast("Voice input needs Chrome or Safari");
    return;
  }
  if (isListening) {
    recognition.stop();
    stopListening();
  } else {
    try {
      recognition.start();
    } catch (e) {
      console.warn("Could not start recognition:", e);
    }
  }
}

btnMic.addEventListener("click", (e) => {
  e.preventDefault();
  toggleListening();
});

// ── Slash Commands Modal & Auto-Trigger ─────────────────────────────────

const cmdSearch = document.getElementById("cmd-search");
const cmdSections = document.querySelectorAll(".cmd-section-title");

let modalSelectedIndex = -1;

function getVisibleCommandItems() {
  const items = document.querySelectorAll(".cmd-item");
  const visible = [];
  items.forEach(item => {
    if (item.style.display !== "none") {
      visible.push(item);
    }
  });
  return visible;
}

function updateModalSelection(index, shouldScroll = true) {
  const visible = getVisibleCommandItems();
  if (visible.length === 0) {
    modalSelectedIndex = -1;
    return;
  }
  
  if (index < 0) index = visible.length - 1;
  if (index >= visible.length) index = 0;
  modalSelectedIndex = index;

  visible.forEach((item, i) => {
    if (i === modalSelectedIndex) {
      item.classList.add("selected");
      if (shouldScroll) {
        item.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } else {
      item.classList.remove("selected");
    }
  });
}

function selectCurrentModalCommand() {
  const visible = getVisibleCommandItems();
  if (visible.length > 0 && modalSelectedIndex >= 0 && modalSelectedIndex < visible.length) {
    const selectedItem = visible[modalSelectedIndex];
    selectedItem.click();
    return true;
  }
  return false;
}

window.handleSmartArrowNav = function(dir) {
  triggerHaptic(12);

  // 1. If Slash Commands Modal is open -> Navigate visible options
  if (commandsModal && (commandsModal.style.display === "flex" || commandsModal.style.display === "block")) {
    const visible = getVisibleCommandItems();
    if (visible.length === 0) return;
    
    let newIndex = modalSelectedIndex;
    if (dir === 'up') {
      newIndex = (newIndex <= 0) ? visible.length - 1 : newIndex - 1;
    } else if (dir === 'down') {
      newIndex = (newIndex >= visible.length - 1) ? 0 : newIndex + 1;
    }
    updateModalSelection(newIndex, true);
    return;
  }

  // 2. If user is currently typing/editing text in prompt box -> Cycle command history
  if (mobileInput.value.trim() !== "" && document.activeElement === mobileInput) {
    handleHistoryNav(dir);
    return;
  }

  // 3. Default / Interactive Mode -> Send ANSI Up/Down arrow directly to active terminal PTY
  // This enables navigating interactive terminal menus, CLI options, and choice prompts
  const arrowCode = dir === 'up' ? '\x1b[A' : '\x1b[B';
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "INPUT", data: arrowCode }));
  }
};

function renderHistorySection() {
  const sec = document.getElementById("history-section");
  const container = document.getElementById("history-items-container");
  if (!sec || !container) return;
  
  if (commandHistory.length === 0) {
    sec.style.display = "none";
    return;
  }

  // Collect all static command names already in the modal so we never duplicate them
  const staticCmds = new Set();
  document.querySelectorAll(".cmd-item[data-cmd]").forEach(el => {
    staticCmds.add(el.getAttribute("data-cmd").trim().toLowerCase());
  });
  
  container.innerHTML = "";
  let added = 0;
  
  // Show up to 6 most recent prompts that are NOT already a static command
  for (const cmd of commandHistory) {
    if (added >= 6) break;
    const key = cmd.trim().toLowerCase().replace(/\s+$/, '');
    if (staticCmds.has(key)) continue;   // skip duplicates of built-in commands

    const item = document.createElement("div");
    item.className = "cmd-item";
    item.onclick = () => insertCommand(cmd);
    
    const tag = document.createElement("span");
    tag.className = "cmd-tag";
    tag.textContent = cmd;
    
    const desc = document.createElement("span");
    desc.className = "cmd-desc";
    desc.textContent = "Tap to recall recent prompt / command";
    
    item.appendChild(tag);
    item.appendChild(desc);
    container.appendChild(item);
    added++;
  }
  
  sec.style.display = added > 0 ? "block" : "none";
}

function openCommandsModal(filter = "") {
  renderHistorySection();
  commandsModal.style.display = "flex";
  if (cmdSearch) {
    cmdSearch.value = filter;
    filterCommands(filter);
    cmdSearch.focus();
  }
}

function filterCommands(query) {
  const q = query.toLowerCase().trim().replace(/^\//, ''); // allow searching with or without leading '/'
  const items = document.querySelectorAll(".cmd-item");
  const sections = document.querySelectorAll(".cmd-section-title");

  items.forEach(item => {
    const text = (item.textContent || "").toLowerCase().replace(/^\//, '');
    const match = !q || text.includes(q);
    item.style.display = match ? "flex" : "none";
  });

  // Hide section titles when filtering so search results are compact
  sections.forEach(sec => {
    sec.style.display = q ? "none" : "block";
  });

  // Highlight first match by default
  updateModalSelection(0, false);
}

if (cmdSearch) {
  cmdSearch.addEventListener("input", (e) => {
    filterCommands(e.target.value);
  });

  cmdSearch.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      handleSmartArrowNav('down');
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      handleSmartArrowNav('up');
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!selectCurrentModalCommand()) {
        if (cmdSearch.value.trim()) {
          insertCommand(cmdSearch.value.trim());
        }
      }
    } else if (e.key === "Escape") {
      commandsModal.style.display = "none";
      mobileInput.focus();
    }
  });
}

// Auto-trigger commands modal when user types '/' in command box
mobileInput.addEventListener("input", (e) => {
  autoGrowInput();
  const val = mobileInput.value.trim();
  if (val === "/") {
    openCommandsModal("/");
  }
});

// Swipe gestures on prompt box to recall history effortlessly
let touchStartX = 0;
let touchStartY = 0;

mobileInput.addEventListener("touchstart", (e) => {
  if (e.touches.length === 1) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
}, { passive: true });

mobileInput.addEventListener("touchend", (e) => {
  if (e.changedTouches.length === 1) {
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaY = e.changedTouches[0].clientY - touchStartY;
    
    // Check for clean horizontal swipe (> 50px horizontal, < 40px vertical)
    if (Math.abs(deltaX) > 50 && Math.abs(deltaY) < 40) {
      if (deltaX > 0) {
        // Swipe Right -> Previous Command in History
        handleHistoryNav('up');
      } else {
        // Swipe Left -> Next Command in History
        handleHistoryNav('down');
      }
    }
  }
}, { passive: true });

btnCommands.addEventListener("click", (e) => {
  e.preventDefault();
  openCommandsModal("");
});

btnCloseModal.addEventListener("click", () => {
  commandsModal.style.display = "none";
});

commandsModal.addEventListener("click", (e) => {
  if (e.target === commandsModal) {
    commandsModal.style.display = "none";
  }
});

window.insertCommand = function(cmd) {
  triggerHaptic(15);
  mobileInput.value = cmd;
  autoGrowInput();
  commandsModal.style.display = "none";
  mobileInput.focus();
  mobileInput.selectionStart = mobileInput.selectionEnd = mobileInput.value.length;
};

// ── Features & Shortcuts Guide Modal ───────────────────────────────────

const btnFeatures = document.getElementById("btn-features");
const featuresModal = document.getElementById("features-modal");
const btnCloseFeatures = document.getElementById("btn-close-features");
const btnGotIt = document.getElementById("btn-got-it");

function openFeaturesModal() {
  triggerHaptic(15);
  if (featuresModal) featuresModal.style.display = "flex";
}

function closeFeaturesModal() {
  triggerHaptic(15);
  if (featuresModal) featuresModal.style.display = "none";
  try {
    localStorage.setItem("termpilot_features_seen", "true");
  } catch (e) {}
}

if (btnFeatures) {
  btnFeatures.addEventListener("click", (e) => {
    e.preventDefault();
    openFeaturesModal();
  });
}

if (btnCloseFeatures) {
  btnCloseFeatures.addEventListener("click", closeFeaturesModal);
}

if (btnGotIt) {
  btnGotIt.addEventListener("click", closeFeaturesModal);
}

if (featuresModal) {
  featuresModal.addEventListener("click", (e) => {
    if (e.target === featuresModal) closeFeaturesModal();
  });
}

// Show guide on first time visit
try {
  if (!localStorage.getItem("termpilot_features_seen")) {
    setTimeout(openFeaturesModal, 800);
  }
} catch (e) {}

// ── Pairing ─────────────────────────────────────────────────────────────

btnPair.addEventListener("click", async () => {
  try {
    btnPair.innerText = "Generating...";
    const res = await fetch("/api/pairing/create", {
      method: "POST",
      headers: { "Authorization": `Bearer ${getAccessKey()}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    pairingCodeBox.innerText = data.code;
    pairingCmdHint.innerText = `python agent.py --pair ${data.code} "Phone"`;
    pairingDisplay.style.display = "block";
    btnPair.style.display = "none";
  } catch (err) {
    showToast("Could not make a pairing code. Is the server running?");
    btnPair.innerText = "Generate pairing code";
  }
});

// Ensure column calculation updates once custom monospace fonts finish rendering
if (document.fonts) {
  document.fonts.ready.then(() => {
    setTimeout(adaptFontSizeToPty, 100);
  });
}

// ── Select & Copy Terminal Text ─────────────────────────────────────────

function showToast(text = "Copied to clipboard") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = text;
  toast.style.display = "block";
  setTimeout(() => {
    toast.style.display = "none";
  }, 1800);
}

function getTerminalBufferText() {
  const buffer = term.buffer.active;
  const lines = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join('\n').trimEnd();
}

function getLastResponseText() {
  const full = getTerminalBufferText();
  if (!full) return "";
  const parts = full.split(/(?=\nPS [A-Z]:\\|\n> |\n\$ )/);
  if (parts.length > 1) {
    return parts[parts.length - 1].trim();
  }
  return full;
}

function copyTextToClipboard(text) {
  if (!text) return;
  triggerHaptic(20);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast("Copied to clipboard");
    }).catch(() => {
      fallbackCopyText(text);
    });
  } else {
    fallbackCopyText(text);
  }
}

function fallbackCopyText(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
    showToast("Copied to clipboard");
  } catch (e) {
    showToast("Could not copy. Long-press the text instead");
  }
  document.body.removeChild(ta);
}

const selectModal = document.getElementById("select-modal");
const selectTextBox = document.getElementById("select-text-box");
const btnCloseSelect = document.getElementById("btn-close-select");

function openTextSelectModal() {
  triggerHaptic(25);
  const text = getTerminalBufferText();
  if (selectTextBox) selectTextBox.textContent = text || "(Terminal buffer is currently empty)";
  if (selectModal) selectModal.style.display = "flex";
}

function closeTextSelectModal() {
  if (selectModal) selectModal.style.display = "none";
}

window.openTextSelectModal = openTextSelectModal;

window.copyFromSelectModal = function() {
  const text = getTerminalBufferText();
  copyTextToClipboard(text);
  closeTextSelectModal();
};

window.copyLastResponse = function() {
  const text = getLastResponseText();
  copyTextToClipboard(text);
  closeTextSelectModal();
};

if (btnCloseSelect) {
  btnCloseSelect.addEventListener("click", closeTextSelectModal);
}
if (selectModal) {
  selectModal.addEventListener("click", (e) => {
    if (e.target === selectModal) closeTextSelectModal();
  });
}

// ── Native Long-Press on Terminal to Trigger Select & Copy ───────────────

let terminalTouchTimer = null;
let terminalTouchMoved = false;

xtermContainer.addEventListener("touchstart", (e) => {
  if (e.touches.length === 1) {
    terminalTouchMoved = false;
    clearTimeout(terminalTouchTimer);
    terminalTouchTimer = setTimeout(() => {
      if (!terminalTouchMoved) {
        openTextSelectModal();
      }
    }, 450); // 450ms long-press hold
  }
}, { passive: true });

xtermContainer.addEventListener("touchmove", () => {
  terminalTouchMoved = true;
  clearTimeout(terminalTouchTimer);
}, { passive: true });

xtermContainer.addEventListener("touchend", () => {
  clearTimeout(terminalTouchTimer);
}, { passive: true });

// ── Boot ────────────────────────────────────────────────────────────────
connect();
