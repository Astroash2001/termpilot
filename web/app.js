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
  fontFamily: "'Courier New', Courier, monospace",
  theme: {
    background: '#070d18',
    foreground: '#e2e8f0',
    cursor: '#38bdf8',
    cursorAccent: '#070d18',
    selectionBackground: 'rgba(56, 189, 248, 0.3)',
    black: '#0b1220',
    red: '#f87171',
    green: '#4ade80',
    yellow: '#f59e0b',
    blue: '#2563eb',
    magenta: '#818cf8',
    cyan: '#38bdf8',
    white: '#e2e8f0',
    brightBlack: '#64748b',
    brightRed: '#fca5a5',
    brightGreen: '#86efac',
    brightYellow: '#fde047',
    brightBlue: '#60a5fa',
    brightMagenta: '#a5b4fc',
    brightCyan: '#67e8f9',
    brightWhite: '#f8fafc',
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
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const headerDot = document.getElementById("header-status-dot");
const headerLabel = document.getElementById("header-status-label");
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
// ── Dynamic PTY Dimension Sync & Responsive Scaling ───────────────────

let ptyCols = 0;
let ptyRows = 0;

const TERM_FONT_FAMILY = "'Courier New', Courier, monospace";

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
  showToast("Text size " + Math.round(termZoom * 100) + "%");
};

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

function setConnected(on) {
  if (on) {
    overlay.style.display = "none";
    headerDot.className = "dot online pulse";
    headerLabel.textContent = "LIVE";
    headerLabel.style.color = "#10b981";
    setTimeout(adaptFontSizeToPty, 50);
    setTimeout(adaptFontSizeToPty, 200);
  } else {
    overlay.style.display = "flex";
    statusDot.className = "dot offline";
    statusText.textContent = "OFFLINE";
    headerDot.className = "dot offline";
    headerLabel.textContent = "OFFLINE";
    headerLabel.style.color = "#ef4444";
  }
}

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setConnected(true);
    adaptFontSizeToPty();
  };

  ws.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "RAW") {
      // Native xterm.js ANSI rendering without forced scrolling interference
      term.write(payload.data);

      // Detect task completion after running a command
      if (isCommandRunning && (performance.now() - lastCommandTime > 3000)) {
        if (payload.data.includes("PS ") || payload.data.includes("> ") || payload.data.includes("? for shortcuts")) {
          isCommandRunning = false;
          playCompletionChime();
          triggerHaptic([25, 40, 25]);
        }
      }
    } else if (payload.type === "PTY_SIZE") {
      ptyCols = payload.cols;
      ptyRows = payload.rows;
      adaptFontSizeToPty();
    } else if (payload.type === "STDERR") {
      // Show errors visibly in the terminal
      term.write("\r\n\x1b[31m" + payload.data + "\x1b[0m\r\n");
    }
  };

  ws.onclose = () => {
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
    btnSoundToggle.textContent = soundEnabled ? "🔔" : "🔕";
    btnSoundToggle.classList.toggle("muted", !soundEnabled);
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
    alert("Voice input is not supported in this browser. Please use Chrome or Safari.");
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
    tag.textContent = "⏱️ " + (cmd.length > 35 ? cmd.substring(0, 35) + "…" : cmd);
    
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
    const res = await fetch("/api/pairing/create", { method: "POST" });
    const data = await res.json();
    pairingCodeBox.innerText = data.code;
    pairingCmdHint.innerText = `python agent.py --pair ${data.code} "Phone"`;
    pairingDisplay.style.display = "block";
    btnPair.style.display = "none";
  } catch (err) {
    alert("Failed to generate pairing code");
    btnPair.innerText = "Generate Pairing Code";
  }
});

// Ensure column calculation updates once custom monospace fonts finish rendering
if (document.fonts) {
  document.fonts.ready.then(() => {
    setTimeout(adaptFontSizeToPty, 100);
  });
}

// ── Select & Copy Terminal Text ─────────────────────────────────────────

function showToast(text = "✓ Copied to clipboard!") {
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
      showToast("✓ Copied to clipboard!");
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
    showToast("✓ Copied to clipboard!");
  } catch (e) {
    alert("Could not copy text.");
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
