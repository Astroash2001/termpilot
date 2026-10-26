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
  // Porcelain's dark glass screen. ANSI hues are tuned for #121212; dim text
  // (brightBlack) holds ~5.6:1, because agents print a lot of it.
  theme: {
    background: '#121212',
    foreground: '#e8e6e1',
    cursor: '#ff4f00', // signal orange marks where the agent is writing
    cursorAccent: '#121212',
    selectionBackground: 'rgba(255, 79, 0, 0.32)',
    black: '#2a2a2a',
    red: '#ff6b5a',
    green: '#6fd08c',
    yellow: '#f2c46d',
    blue: '#7aa7ff',
    magenta: '#d39bf0',
    cyan: '#5fd0dc',
    white: '#d9d7d2',
    brightBlack: '#8b8984',
    brightRed: '#ff8f80',
    brightGreen: '#93e0aa',
    brightYellow: '#f7d897',
    brightBlue: '#a3c2ff',
    brightMagenta: '#e4bdf6',
    brightCyan: '#8fe0ea',
    brightWhite: '#ffffff',
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

// Manual text-size control. While the phone sizes the PTY (phone fit, below) A-/A+ change
// the font and the PC re-wraps to the new column count. While the PC sizes it, they scale
// the font only: columns stay pinned to ptyCols, because a phone wrapping lines the PTY
// never wrapped brings the duplicated-menu bug straight back.
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

// ── Phone fit ──
// The PTY lives on the PC, so by default it is as wide as the PC's console window (~120
// columns) and the phone must shrink the text to show it. Instead the phone asks the agent
// to size the PTY to this screen at a readable font, so the shell and every app in it wrap
// to the phone. The agent hands the size back to the PC as soon as someone types there and
// back to the phone on its next input (tmux's "latest client" rule).
const FIT_FONT = 12; // px at 100% zoom: about 50 columns on a 390px-wide phone
let wsAuthed = false;
let fitCols = 0, fitRows = 0; // the size this phone last asked for
let fitPending = false; // asked, and the PC hasn't answered with a PTY_SIZE yet

function fitFontSize() {
  return Math.max(7, Math.min(28, FIT_FONT * termZoom));
}

// Call right after fit() at the fit font: the fitted grid is the size to ask the PC for.
// The font changes on the phone at once; the PC is asked once taps (A−/A+) or a rotation
// settle, so three quick taps cost one PTY resize and one app redraw, not three.
let fitTimer = 0;
function requestPhoneFit() {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(sendPhoneFit, 250);
}

function sendPhoneFit() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const cols = term.cols, rows = term.rows;
  if (cols < 20 || rows < 5) return;
  // The keyboard sliding up only costs rows. Resizing the PTY for that would make every app
  // redraw each time the prompt box is tapped, so rows alone only change with the keyboard down.
  const typing = document.activeElement === mobileInput;
  if (cols === fitCols && (rows === fitRows || typing)) return;
  fitCols = cols;
  fitRows = rows;
  fitPending = true;
  ws.send(JSON.stringify({ type: "RESIZE", cols, rows }));
}

function adaptFontSizeToPty() {
  const container = document.getElementById('xterm-container');
  if (!container) return;
  const availableWidth = container.clientWidth || window.innerWidth || 400;
  // Phone fit holds until the PC takes the terminal back, which shows as a PTY_SIZE that
  // isn't the one we asked for. The font only changes when that happens, never per call.
  const phoneFit = wsAuthed && ptyCols >= 20 && (!fitCols || fitPending || ptyCols === fitCols);

  // Past 1x the grid is wider than the screen, so let the wrapper pan horizontally.
  // At 1x this class is absent and the layout is byte-for-byte what it was before.
  container.classList.toggle('zoomed', !phoneFit && termZoom > 1.001);

  if (phoneFit) {
    if (Math.abs(term.options.fontSize - fitFontSize()) > 0.1) term.options.fontSize = fitFontSize();
  } else if (ptyCols && ptyCols >= 20) {
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
    if (phoneFit) {
      // The fitted grid is this screen at a readable size: the PTY follows it
      requestPhoneFit();
    } else if (ptyCols && ptyCols >= 20 && term.cols !== ptyCols) {
      // fit() derives columns from the container, which can still land a column or two off.
      // Wrapping must match the PTY exactly, so pin the columns and keep the fitted rows.
      term.resize(ptyCols, term.rows);
    }
  } catch (e) {}
}

// ── Coding agents ───────────────────────────────────────────────────────
// TermPilot drives a plain terminal, so any coding agent can run in it. Each profile says
// how to recognise the agent (the command that starts it, the banner it prints), the text
// it shows while busy, and its slash commands for the / sheet. An agent with no profile
// still works: its "esc to interrupt" style marker is enough to end runs correctly.

const AGENT_PROFILES = {
  claude: {
    name: "Claude Code",
    bins: ["claude", "claude-code"],
    banner: /Claude Code/,
    busy: /esc to interrupt/i,
    commands: [
      { title: "Session", items: [
        ["/clear", "Start fresh, clearing the conversation"],
        ["/compact", "Summarise the conversation to free context"],
        ["/context", "Show what is using the context window"],
        ["/cost", "Show token usage and cost for this session"],
        ["/resume", "Resume an earlier conversation"],
        ["/rewind", "Roll the conversation and code back to a checkpoint"],
        ["/export", "Export the conversation"],
        ["/exit", "Quit Claude Code"],
      ] },
      { title: "Project", items: [
        ["/init", "Create a CLAUDE.md for this project"],
        ["/memory", "Edit CLAUDE.md memory files"],
        ["/add-dir ", "Add another working directory"],
        ["/review", "Review a pull request"],
      ] },
      { title: "Model & tools", items: [
        ["/model", "Choose the model"],
        ["/permissions", "View or change tool permissions"],
        ["/mcp", "Manage MCP servers"],
        ["/agents", "Manage subagents"],
        ["/hooks", "Manage hooks"],
        ["/config", "Open settings"],
      ] },
      { title: "Account & help", items: [
        ["/status", "Show version, model and account"],
        ["/doctor", "Check the installation"],
        ["/login", "Sign in"],
        ["/logout", "Sign out"],
        ["/help", "List all commands"],
      ] },
    ],
  },
  codex: {
    name: "Codex",
    bins: ["codex"],
    banner: /OpenAI Codex/i,
    busy: /esc to interrupt/i,
    commands: [
      { title: "Session", items: [
        ["/new", "Start a new conversation"],
        ["/compact", "Summarise the conversation to free context"],
        ["/diff", "Show the git diff, including untracked files"],
        ["/review", "Review the current changes"],
        ["/mention ", "Mention a file"],
        ["/quit", "Quit Codex"],
      ] },
      { title: "Setup", items: [
        ["/init", "Create an AGENTS.md for this project"],
        ["/model", "Choose the model and reasoning effort"],
        ["/approvals", "Choose what Codex may do without asking"],
        ["/mcp", "List configured MCP tools"],
        ["/status", "Show session settings and token usage"],
        ["/logout", "Sign out"],
      ] },
    ],
  },
  gemini: {
    name: "Gemini CLI",
    bins: ["gemini", "gemini-cli"],
    banner: /Gemini CLI/i,
    busy: /esc to cancel/i,
    commands: [
      { title: "Session", items: [
        ["/clear", "Clear the screen and conversation"],
        ["/compress", "Summarise the conversation to free context"],
        ["/chat ", "Save, resume or list conversations"],
        ["/restore", "Undo file changes from a tool call"],
        ["/copy", "Copy the last answer"],
        ["/stats", "Show token usage for this session"],
        ["/quit", "Quit Gemini CLI"],
      ] },
      { title: "Project & tools", items: [
        ["/init", "Create a GEMINI.md for this project"],
        ["/memory ", "Show, add to or reload memory"],
        ["/directory ", "Add or list workspace directories"],
        ["/tools", "List available tools"],
        ["/mcp", "List MCP servers and tools"],
        ["/extensions", "List active extensions"],
      ] },
      { title: "Settings & help", items: [
        ["/settings", "Open settings"],
        ["/theme", "Change the theme"],
        ["/auth", "Change how you sign in"],
        ["/about", "Show version info"],
        ["/help", "List all commands"],
      ] },
    ],
  },
  aider: {
    name: "Aider",
    bins: ["aider", "aider-chat"],
    banner: /^Aider v\d/m,
    busy: /Waiting for /i,
    commands: [
      { title: "Files", items: [
        ["/add ", "Add files to the chat"],
        ["/drop ", "Remove files from the chat"],
        ["/ls", "List files in and out of the chat"],
        ["/map", "Show the repository map"],
      ] },
      { title: "Modes", items: [
        ["/ask ", "Ask without editing files"],
        ["/code ", "Ask for code changes"],
        ["/architect ", "Plan with one model, edit with another"],
      ] },
      { title: "Git & checks", items: [
        ["/diff", "Show changes since the last message"],
        ["/undo", "Undo the last commit Aider made"],
        ["/commit", "Commit outside edits"],
        ["/run ", "Run a shell command"],
        ["/test ", "Run tests and fix failures"],
        ["/lint", "Lint and fix files"],
      ] },
      { title: "Session", items: [
        ["/model ", "Switch the model"],
        ["/tokens", "Show context token usage"],
        ["/clear", "Clear the chat history"],
        ["/reset", "Drop all files and clear history"],
        ["/help", "List all commands"],
        ["/exit", "Quit Aider"],
      ] },
    ],
  },
  agy: {
    name: "Antigravity",
    bins: ["agy"],
    // No banner: "Antigravity" turns up in ordinary output (docs, tips, paths), so only
    // typing agy marks it running
    busy: /esc to interrupt/i,
    commands: [
    { title: "Workspace & context", items: [
      ["/add-dir ", "Add a directory to the workspace context"],
      ["/worktree ", "Manage git worktrees for isolated parallel branches"],
      ["/files", "List and inspect loaded project workspace files"],
      ["/context", "View active context window tokens and loaded files"],
      ["/compact", "Compress conversation history to save tokens"],
      ["clear", "Clear terminal screen and reset view"],
      ["/reset", "Reset the workspace session to initial state"]
    ] },
    { title: "Agent modes & workflows", items: [
      ["/plan ", "Step-by-step implementation planning before execution"],
      ["/goal ", "Autonomous execution until goal is fully achieved"],
      ["/resume ", "Resume a paused task, session, or checkpoint"],
      ["/grill-me ", "Interactive interview to resolve design decisions"],
      ["/teamwork-preview ", "Coordinate a team of autonomous subagents"],
      ["/learn ", "Save workflow patterns & lessons for future tasks"],
      ["/schedule ", "Run recurring cron or one-time timer notifications"],
      ["/run ", "Execute scripts or commands directly with the agent"],
      ["/review ", "Review recent code changes, diffs, and pull requests"]
    ] },
    { title: "Subagents & artifacts", items: [
      ["/agents", "List available custom agents and personas"],
      ["/subagents", "Inspect active background subagents and conversations"],
      ["/artifact", "View and review generated markdown and code artifacts"],
      ["/diff", "View git diff of file modifications in this session"],
      ["/transcript", "Inspect full chronological conversation & tool execution logs"],
      ["/undo", "Revert the last batch of agent file modifications"],
      ["/save", "Save the current session state checkpoint"]
    ] },
    { title: "Skills, rules & MCP", items: [
      ["/skills", "List, activate, and manage loaded agent skills"],
      ["/rules", "View and edit project rules and workflows"],
      ["/mcp", "Manage Model Context Protocol (MCP) server integrations"],
      ["/plugins", "View and configure installed Antigravity plugins"],
      ["/tools", "Inspect all available system tools and declarations"],
      ["/config", "View and edit CLI settings and preferences"]
    ] },
    { title: "Models & reasoning", items: [
      ["/model ", "Switch AI model (Gemini 3.7 Flash, Claude Opus, GPT, etc.)"],
      ["/params ", "Configure temperature, thinking depth, and model parameters"],
      ["/permissions", "Manage auto-execution and tool safety approvals"]
    ] },
    { title: "Chat & interaction", items: [
      ["/btw ", "Ask a side question without interrupting current task"],
      ["/voice", "Toggle voice transcription / speech interactions"],
      ["/prompt ", "Load or manage custom system prompt templates"],
      ["/feedback ", "Provide feedback or report an issue on agent behavior"]
    ] },
    { title: "System & account", items: [
      ["/help", "Display full CLI command reference & shortcuts"],
      ["/status", "View active tasks, subagents, and memory state"],
      ["/usage", "Check API quota, token consumption, and credits"],
      ["/cost", "View token cost breakdown for the current session"],
      ["/changelog", "Show Antigravity release notes and changes"],
      ["/version", "Show current Antigravity CLI version"],
      ["/theme ", "Switch terminal UI theme and color scheme"],
      ["/login", "Sign in and authenticate Antigravity account"],
      ["/logout", "Sign out of current Antigravity account"],
      ["agy", "Launch Antigravity assistant"],
      ["/exit", "Terminate and exit current session"]
    ] }
  ],
  },
};

// Most agent TUIs show one of these while they work; it identifies an agent with no profile
const GENERIC_BUSY = /esc to (interrupt|cancel)|ctrl\+c to (interrupt|cancel)/i;
const GENERIC_AGENT = { name: "Coding agent", busy: GENERIC_BUSY, commands: [] };
const QUIET_MS = 2500; // an idle agent stops printing: this long silent and not busy means done

let currentAgent = null; // profile id, "generic", or null while the plain shell has the terminal
let lastAgent = null;    // the / sheet keeps the last agent's commands after it exits
let quietTimer = null;
const agentLabel = document.getElementById("agent-label");

function agentProfile(id = currentAgent) {
  return id === "generic" ? GENERIC_AGENT : AGENT_PROFILES[id] || null;
}

function setAgent(id) {
  if (id === currentAgent) return;
  currentAgent = id;
  if (id) lastAgent = id;
  agentLabel.textContent = id ? agentProfile(id).name : "Terminal";
}

// The command that starts an agent: "claude", "codex --model x", "npx @openai/codex@latest",
// "C:\tools\aider.exe". Only the program word counts, so "git commit -m claude" is not a launch.
function detectAgentFromCommand(text) {
  const words = text.trim().split(/\s+/);
  let program = words[0] || "";
  if (/^(npx|bunx|pnpx)$/i.test(program) || (/^(pnpm|yarn)$/i.test(program) && /^dlx$/i.test(words[1] || ""))) {
    program = words.slice(1).find((w) => !w.startsWith("-") && !/^dlx$/i.test(w)) || "";
  }
  const name = program.toLowerCase().split(/[\\/]/).pop().replace(/@.*$/, "").replace(/\.(exe|cmd|ps1|bat)$/, "");
  for (const [id, profile] of Object.entries(AGENT_PROFILES)) {
    if (profile.bins.includes(name)) return id;
  }
  return null;
}

// Banners catch agents started another way (a script, an alias, a session already open).
// Only while the shell has the terminal: an agent quoting another agent's name must not relabel it.
function noteAgentOutput(chunk) {
  if (currentAgent && currentAgent !== "generic") return;
  const text = chunk.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  for (const [id, profile] of Object.entries(AGENT_PROFILES)) {
    if (profile.banner?.test(text)) return setAgent(id);
  }
  if (!currentAgent && GENERIC_BUSY.test(text)) setAgent("generic");
}

// True while any visible line shows the agent's "still working" marker
function agentLooksBusy() {
  const profile = agentProfile();
  const buf = term.buffer.active;
  for (let y = buf.baseY; y < buf.baseY + term.rows; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    const text = line.translateToString(true);
    if (profile.busy.test(text) || GENERIC_BUSY.test(text)) return true;
  }
  return false;
}

// The / sheet lists the running agent's commands, or the last one's after it exits
const agentCommands = document.getElementById("agent-commands");
const commandsTitle = document.getElementById("commands-title");
let renderedAgent;

function renderAgentCommands() {
  const id = currentAgent || lastAgent;
  if (id === renderedAgent) return;
  renderedAgent = id;
  const profile = agentProfile(id);
  // Rows are real buttons so screen readers and keyboards can reach them
  const make = (cls, text) => { const el = document.createElement(cls === "cmd-item" ? "button" : "span"); if (cls === "cmd-item") el.type = "button"; el.className = cls; if (text) el.textContent = text; return el; };
  if (!profile || !profile.commands.length) {
    commandsTitle.textContent = "Agent commands";
    const note = document.createElement("p");
    note.className = "cmd-empty";
    note.textContent = profile
      ? `${profile.name} is running. TermPilot doesn't know its commands, so type them in the box.`
      : "Run any program in the terminal. Start a coding agent such as claude, codex, gemini, aider or agy and its commands show up here.";
    agentCommands.replaceChildren(note);
    return;
  }
  commandsTitle.textContent = `${profile.name} commands`;
  agentCommands.replaceChildren(...profile.commands.flatMap((section) => {
    const title = document.createElement("div");
    title.className = "cmd-section-title";
    title.textContent = section.title;
    return [title, ...section.items.map(([insert, desc]) => {
      const item = make("cmd-item");
      item.dataset.cmd = insert.trim();
      item.onclick = () => insertCommand(insert);
      item.append(make("cmd-tag", insert.trim()), make("cmd-desc", desc));
      return item;
    })];
  }));
}

// ── Status capsule ──────────────────────────────────────────────────────
// Says only whether the phone reaches the PC's terminal. Below it, what was last sent.
// Runs are still tracked so the chime can sound when one ends; nothing pops up.

const runStamp = document.getElementById("run-stamp");
const capLabel = document.getElementById("cap-label");
const runPrompt = document.getElementById("run-prompt");
const runMeta = document.getElementById("run-meta");

let runChimes = true;

const CAPSULE_LABELS = { READY: "Connected", OFFLINE: "Offline", "NO PC": "PC offline", LOCKED: "Locked" };

// The capsule animates its width, which CSS can't do to "auto": measure the new content
// on a hidden clone, pin the old width, then let the transition run to the new one.
function sizeCapsule() {
  const probe = runStamp.cloneNode(true);
  probe.removeAttribute("id");
  probe.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  probe.style.cssText = "position:absolute;visibility:hidden;width:auto;transition:none";
  runStamp.parentNode.appendChild(probe);
  const target = probe.offsetWidth;
  probe.remove();
  runStamp.style.width = runStamp.offsetWidth + "px";
  requestAnimationFrame(() => { runStamp.style.width = target + "px"; });
}

function setStamp(state, label) {
  const text = CAPSULE_LABELS[label] || label;
  if (runStamp.dataset.state === state && capLabel.textContent === text) return;
  // The home and chat screens carry a small copy of the capsule
  document.querySelectorAll(".conn-mirror").forEach((m) => { m.dataset.state = state; m.textContent = text; });
  runStamp.dataset.state = state;
  capLabel.textContent = text;
  sizeCapsule();
  runStamp.classList.remove("pop");
  void runStamp.offsetWidth;
  runStamp.classList.add("pop");
}

function startRun(label, { chime = true } = {}) {
  runChimes = chime;
  runPrompt.textContent = label;
}

// Stop waiting for the run to end (agent dropped, connection lost)
function abandonRun(reason) {
  isCommandRunning = false;
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
function checkRunComplete() {
  if (!isCommandRunning || performance.now() - lastCommandTime <= 3000) return;
  if (terminalShowsPrompt()) return completeRun();
  // Inside an agent the shell prompt never returns. The agent is done once it stops
  // printing and nothing on screen says it is still working.
  if (agentProfile()) {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(checkAgentIdle, QUIET_MS);
  }
}

function checkAgentIdle() {
  if (!isCommandRunning || !agentProfile()) return;
  // Silent but still marked busy (a long tool call): look again later
  if (agentLooksBusy()) {
    quietTimer = setTimeout(checkAgentIdle, QUIET_MS);
    return;
  }
  completeRun();
}

function completeRun() {
  clearTimeout(quietTimer);
  isCommandRunning = false;
  if (runChimes) {
    playCompletionChime();
    triggerHaptic([25, 40, 25]);
  }
}

function setConnected(on) {
  if (on) {
    overlay.style.display = "none";
    setStamp("ready", "READY");
    runMeta.textContent = "connected";
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

// ── Output colouring ────────────────────────────────────────────────────
// Much Windows output arrives with no colour at all (PowerShell, many tools, an agent's
// plain prose), so the screen reads as one grey block. Text the program left in the default
// colour gets light highlighting: errors red, warnings amber, passes green, paths and links
// blue, and the shell prompt dimmed with its folder in cyan. Anything the program coloured
// itself is left alone. The inserted codes are zero-width, so cursor positions and TUI
// redraws are unaffected, and copied text is unchanged.

const ESC = "\x1b";
const DEFAULT_FG = ESC + "[39m";
const HIGHLIGHT = new RegExp([
  /(https?:\/\/[^\s'"<>)\]]+)/.source,                                                        // 1 link
  /((?:[A-Za-z]:\\|\.{1,2}[\\/]|[\\/])?(?:[\w.@-]+[\\/])+[\w.@-]+\.[A-Za-z0-9]{1,6}(?::\d+){0,2})/.source, // 2 path in a folder
  /\b([\w-]+\.(?:py|js|mjs|ts|tsx|jsx|json|md|html|css|go|rs|java|cs|cpp|c|h|rb|php|sh|ps1|yml|yaml|toml|txt|lock|sql)(?::\d+){0,2})\b/.source, // 3 bare file
  /(\b(?:error|errors|failed|failure|failures|fatal|exception|traceback|denied|cannot|unable)\b|\b\w+(?:Error|Exception)\b|✗|✘)/.source, // 4 problem (incl. ModuleNotFoundError)
  /(\b(?:warning|warnings|warn|deprecated)\b|⚠)/.source,                                    // 5 warning
  /(\b(?:passed|passing|success|successful|successfully|succeeded|completed|done|ok)\b|✓|✔)/.source, // 6 good
].join("|"), "gi");
const HIGHLIGHT_CODES = [null, [ESC + "[4;34m", ESC + "[24;39m"], [ESC + "[34m"], [ESC + "[34m"], [ESC + "[31m"], [ESC + "[33m"], [ESC + "[32m"]];
const PROMPT_LINE = /^(PS )([A-Za-z]:\\[^>\r\n]*)(>)/;
// One escape sequence: CSI, OSC, a charset pick (ESC ( B), or any two-byte escape (ESC 7, ESC M)
const ESC_SEQ = /\x1b(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()*+#%][ -~]|[^\[\]()*+#%])/g;

let fgIsDefault = true;   // the program's current foreground colour is the default
let atLineStart = true;
let heldEscape = "";      // an escape sequence cut off at the end of the last chunk

// Follow SGR codes so highlighting only ever paints text the program left uncoloured
function trackSgr(seq) {
  const params = seq.slice(2, -1).split(";");
  for (let i = 0; i < params.length; i++) {
    const n = params[i] === "" ? 0 : Number(params[i]);
    if (n === 0 || n === 39) fgIsDefault = true;
    else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) fgIsDefault = false;
    else if (n === 38) { fgIsDefault = false; i += params[i + 1] === "5" ? 2 : 4; }
    else if (n === 48) i += params[i + 1] === "5" ? 2 : 4; // background colour: skip its arguments
  }
}

function highlightLine(text) {
  if (!fgIsDefault || !text) return text;
  let lead = "";
  if (atLineStart) {
    const m = PROMPT_LINE.exec(text);
    if (m) {
      lead = ESC + "[90m" + m[1] + ESC + "[36m" + m[2] + ESC + "[90m" + m[3] + DEFAULT_FG;
      text = text.slice(m[0].length);
    }
  }
  return lead + text.replace(HIGHLIGHT, (match, ...groups) => {
    const g = groups.slice(0, 6).findIndex((v) => v !== undefined) + 1;
    const [open, close = DEFAULT_FG] = HIGHLIGHT_CODES[g];
    return open + match + close;
  });
}

function highlightText(text) {
  let out = "";
  for (const part of text.split(/(\r\n|\r|\n)/)) {
    if (part === "\r\n" || part === "\r" || part === "\n") { out += part; atLineStart = true; continue; }
    out += highlightLine(part);
    if (part) atLineStart = false;
  }
  return out;
}

function colourise(chunk) {
  chunk = heldEscape + chunk;
  heldEscape = "";
  // Keep a trailing, unfinished escape for the next chunk instead of painting inside it
  const lastEsc = chunk.lastIndexOf(ESC);
  if (lastEsc !== -1) {
    ESC_SEQ.lastIndex = lastEsc;
    const m = ESC_SEQ.exec(chunk);
    // Bounded, so a stray ESC can never hold back the stream
    if ((!m || m.index !== lastEsc) && chunk.length - lastEsc < 256) {
      heldEscape = chunk.slice(lastEsc);
      chunk = chunk.slice(0, lastEsc);
    }
  }
  let out = "", last = 0, m;
  ESC_SEQ.lastIndex = 0;
  while ((m = ESC_SEQ.exec(chunk))) {
    out += highlightText(chunk.slice(last, m.index)) + m[0];
    if (m[0][1] === "[" && m[0].endsWith("m")) trackSgr(m[0]);
    last = ESC_SEQ.lastIndex;
  }
  return out + highlightText(chunk.slice(last));
}

// Output arriving within one frame is parsed and painted once. A TUI frame comes in
// several messages, and drawing each separately shows half-drawn screens.
let rawPending = "", rawFrame = 0;
function flushRaw() {
  cancelAnimationFrame(rawFrame);
  rawFrame = 0;
  const chunk = rawPending;
  rawPending = "";
  if (!chunk) return;
  pulsePcScreen();
  noteAgentOutput(chunk);
  // Completion is checked once the chunk is parsed, so the cursor line is current.
  term.write(colourise(chunk), () => {
    // Back at a bare shell prompt: whatever agent was running has exited
    if (currentAgent && performance.now() - lastCommandTime > 1500 && terminalShowsPrompt()) setAgent(null);
    checkRunComplete();
  });
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
      wsAuthed = true;
      // A new link: the old size may be stale and the PC may have the terminal back.
      // Phone fit starts once the relay says what size the PTY is now.
      fitCols = fitRows = ptyCols = ptyRows = 0;
      fitPending = false;
      // The relay replays its saved output next. Written over what this phone already
      // shows, every reconnect (lock, app switch, network change) would add another copy.
      rawPending = "";
      term.reset();
      setConnected(true);
      adaptFontSizeToPty();
      offerGuideOnce();
      window.Chat?.onConnected(payload);
    } else if (typeof payload.type === "string" && payload.type.startsWith("CHAT_")) {
      window.Chat?.onMessage(payload);
    } else if (payload.type === "RAW") {
      rawPending += payload.data;
      if (!rawFrame) rawFrame = requestAnimationFrame(flushRaw);
    } else if (payload.type === "PTY_SIZE") {
      // Output sent before the resize must be drawn at the old size
      flushRaw();
      ptyCols = payload.cols;
      ptyRows = payload.rows;
      fitPending = false;
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
    wsAuthed = false;
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

// ── Desk PC figure (the chime toggle) ───────────────────────────────────
// Isometric kernel from iso-figure by Tolga Cohce, via iso-glow by April Zhu (both MIT).
// +x runs down-right, +y down-left, +z up; rects drawn on a face plane land on that face.
const ISO_C = Math.cos(Math.PI / 6), ISO_S = Math.sin(Math.PI / 6);
const isoD = (x, y, z) => [(x - y) * ISO_C, (x + y) * ISO_S - z];
function isoPlane(o, u, v) {
  const [a, b] = isoD(...u), [c, d] = isoD(...v), [e, f] = isoD(...o);
  return `matrix(${a} ${b} ${c} ${d} ${e.toFixed(2)} ${f.toFixed(2)})`;
}
const isoTop = (x, y, z) => isoPlane([x, y, z], [1, 0, 0], [0, 1, 0]);
const isoFront = (x, y, z) => isoPlane([x, y, z], [1, 0, 0], [0, 0, -1]); // the y = max face
const isoSide = (x, y, z) => isoPlane([x, y, z], [0, -1, 0], [0, 0, -1]); // the x = max face

const PC_KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

function drawPcFigure(svg) {
  const pts = [];
  const rect = (t, w, h, cls, attrs = "") => `<rect transform="${t}" width="${w}" height="${h}" class="${cls}" ${attrs}/>`;
  const box = (x, y, z, w, d, h) => {
    for (const p of [[x, y, z], [x + w, y, z], [x, y + d, z], [x + w, y + d, z]]) pts.push(isoD(p[0], p[1], p[2]), isoD(p[0], p[1], p[2] + h));
    return rect(isoTop(x, y, z + h), w, d, "pc-top") + rect(isoFront(x, y + d, z + h), w, h, "pc-front") + rect(isoSide(x + w, y + d, z + h), d, h, "pc-side");
  };
  // Back to front: stand, monitor, then the keyboard in front of it
  let out = box(44, -64, 0, 32, 22, 3) + box(56, -54, 3, 8, 4, 19) + box(4, -50, 22, 112, 4, 70);
  const screen = isoFront(4, -46, 92);
  out += rect(screen, 100, 58, "pc-glass", 'x="6" y="6"');
  [60, 84, 44, 72].forEach((w, i) => { out += rect(screen, w, 4, "pc-scr", `x="14" y="${16 + i * 11}"`); });
  out += box(0, 0, 0, 120, 44, 5);
  const keys = isoTop(0, 0, 5);
  PC_KEY_ROWS.forEach((row, r) => {
    [...row].forEach((k, c) => { out += rect(keys, 9, 7, "pc-key", `x="${5 + r * 5 + c * 11}" y="${4 + r * 10}" data-k="${k}"`); });
  });
  out += rect(keys, 55, 7, "pc-key", 'x="30" y="34" data-k=" "');
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  svg.setAttribute("viewBox", `${(minX - 2).toFixed(1)} ${(minY - 2).toFixed(1)} ${(Math.max(...xs) - minX + 4).toFixed(1)} ${(Math.max(...ys) - minY + 4).toFixed(1)}`);
  svg.innerHTML = out;
}

const pcFigArt = document.getElementById("pc-fig-art");
if (pcFigArt) drawPcFigure(pcFigArt);

let pcScreenTimer = null;
// Output arrived: light the screen briefly; a steady stream keeps it lit
function pulsePcScreen() {
  if (!btnSoundToggle) return;
  btnSoundToggle.classList.add("hot");
  clearTimeout(pcScreenTimer);
  pcScreenTimer = setTimeout(() => btnSoundToggle.classList.remove("hot"), 180);
}

// Flash the key for the last character typed; keys the drawing lacks (digits, symbols) stay dark
function flashPcKey(typed) {
  const ch = (typed || "").slice(-1).toLowerCase();
  const key = ch && pcFigArt && [...pcFigArt.querySelectorAll(".pc-key")].find((el) => el.dataset.k === ch);
  if (!key) return;
  key.classList.remove("hot");
  void key.getBBox(); // restart the fade if the same key is hit twice in a row
  key.classList.add("hot");
  clearTimeout(key._fade);
  key._fade = setTimeout(() => key.classList.remove("hot"), 120);
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

// The cursor line is asking for a password ("Password:", "user@host's password:",
// "Enter passphrase for key ...:"). Wrapped rows are joined first: phone fit makes long
// prompts wrap, which would split the word from the colon.
function terminalAsksForSecret() {
  const buf = term.buffer.active;
  let row = buf.baseY + buf.cursorY;
  let text = buf.getLine(row)?.translateToString(true) || "";
  while (row > 0 && buf.getLine(row)?.isWrapped) {
    row -= 1;
    text = (buf.getLine(row)?.translateToString(true) || "") + text;
  }
  return /(pass(word|phrase|code)|\bpin\b|secret|token).*:\s*$/i.test(text);
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
  // An answer to a password prompt is sent and forgotten: never saved to history, shown as
  // the run title, or used as notification text (which can show on the lock screen)
  if (terminalAsksForSecret()) {
    ws.send(JSON.stringify({ type: "INPUT", data: sanitizeTerminalInput(text) + "\r" }));
    mobileInput.value = "";
    mobileInput.style.height = "48px";
    mobileInput.focus();
    return;
  }
  saveToHistory(text);
  // Typing an agent's name at the shell starts it; inside an agent, words are just a prompt
  if (!currentAgent) {
    const launched = detectAgentFromCommand(text);
    if (launched) setAgent(launched);
  }
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

    const item = document.createElement("button");
    item.type = "button";
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
  renderAgentCommands();
  renderHistorySection();
  commandsModal.style.display = "flex";
  if (cmdSearch) {
    cmdSearch.value = filter;
    filterCommands(filter);
    // Typing "/..." opened the sheet: keep typing in search. Opened from the key, the list
    // matters more than a keyboard that would cover half of it.
    if (filter) cmdSearch.focus();
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

  // Highlight the first match while searching; an unfiltered list starts with nothing picked
  if (q) updateModalSelection(0, false);
  else {
    modalSelectedIndex = -1;
    items.forEach((item) => item.classList.remove("selected"));
  }
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
  flashPcKey(e.data);
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
    commandsModal.style.display = "none"; // one sheet at a time
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

// First visit: the guide opens once the phone is unlocked, never behind the unlock screen
let guideOffered = false;
function offerGuideOnce() {
  if (guideOffered) return;
  guideOffered = true;
  try {
    if (!localStorage.getItem("termpilot_features_seen")) setTimeout(openFeaturesModal, 600);
  } catch (e) {}
}

// ── Pairing ─────────────────────────────────────────────────────────────

// Asked for on a WebSocket of its own, never over HTTP: ngrok and proxies log HTTP headers,
// and the access key would be one of them.
btnPair.addEventListener("click", () => {
  btnPair.innerText = "Generating...";
  let got = false;
  const pairWs = new WebSocket(WS_URL);
  pairWs.onopen = () => pairWs.send(JSON.stringify({ type: "AUTH", key: getAccessKey(), purpose: "pair" }));
  pairWs.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type !== "PAIR_CODE") return;
    got = true;
    pairWs.close();
    pairingCodeBox.innerText = data.code;
    pairingCmdHint.innerText = `python agent.py --pair ${data.code} "Phone"`;
    pairingDisplay.style.display = "block";
    btnPair.style.display = "none";
  };
  pairWs.onclose = () => {
    if (got) return;
    showToast("Could not make a pairing code. Is the server running?");
    btnPair.innerText = "Generate pairing code";
  };
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
    if (!line) continue;
    // A row the terminal wrapped continues the one above: join them, keeping the spaces at
    // the wrap point, or copied text gets a line break in the middle of a word
    const text = line.translateToString(!buffer.getLine(i + 1)?.isWrapped);
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
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

// ── Native touch scrolling ──────────────────────────────────────────────
// xterm.js 5 handles touch itself: it cancels every touchmove, moves its viewport by hand,
// and snaps back to a whole row on each repaint. A phone gets no fling and a jittery,
// row-stepped drag. On touch screens a transparent native scroller sits over the terminal
// instead, so the browser scrolls with the phone's own physics. The terminal follows it:
// whole rows through scrollToLine, the part of a row as a transform on the screen.
// shortcut: in the zoomed pan mode (PC owns the size, zoom > 1) the scroller only covers
// the first screen width; past it xterm's own touch scrolling takes over.
if (window.matchMedia("(pointer: coarse)").matches) {
  const scroller = document.createElement("div");
  scroller.className = "scroll-proxy";
  const fill = document.createElement("div");
  scroller.appendChild(fill);
  xtermContainer.appendChild(scroller);
  const screen = term.element.querySelector(".xterm-screen");
  // Fractional on purpose: a rounded row height drifts by rows deep in the scrollback
  const rowHeight = () => screen.getBoundingClientRect().height / term.rows;

  // Only a finger, or the fling it leaves behind, drives the terminal. Layout changes
  // (new output, a resize, a font change) also fire scroll events, and those must not.
  let touching = false;
  let flingUntil = 0;
  const userScrolling = () => touching || performance.now() < flingUntil;
  scroller.addEventListener("touchstart", () => { touching = true; }, { passive: true });
  const lift = () => { touching = false; flingUntil = performance.now() + 200; };
  scroller.addEventListener("touchend", lift, { passive: true });
  scroller.addEventListener("touchcancel", lift, { passive: true });

  scroller.addEventListener("scroll", () => {
    if (!userScrolling()) return;
    if (!touching) flingUntil = performance.now() + 200; // still gliding
    const rh = rowHeight();
    if (!rh) return;
    const exact = scroller.scrollTop / rh;
    const line = Math.min(Math.floor(exact), term.buffer.active.baseY);
    if (line !== term.buffer.active.viewportY) term.scrollToLine(line);
    screen.style.transform = `translate3d(0, ${-(exact - line) * rh}px, 0)`;
  }, { passive: true });

  // The terminal moved on its own (new output, scrollToBottom, a resize): bring the
  // scroller along, unless a finger or fling is moving it right now.
  // Runs after every paint, so it writes to the page only when a value changed: each
  // write forces a layout, and streaming output paints many times a second.
  let fillHeight = -1;
  const follow = () => {
    const rh = rowHeight();
    if (!rh) return;
    const buf = term.buffer.active;
    const height = buf.baseY * rh + scroller.clientHeight;
    if (height !== fillHeight) { fillHeight = height; fill.style.height = height + "px"; }
    if (userScrolling()) return;
    const top = buf.viewportY * rh;
    if (Math.abs(scroller.scrollTop - top) > 1) scroller.scrollTop = top;
    if (screen.style.transform) screen.style.transform = "";
  };
  term.onScroll(follow);
  // After each paint the row height is current, including after a font or size change
  term.onRender(follow);
  follow();

  // Full-screen apps (Claude Code's fullscreen renderer, vim, less) draw on the alternate
  // screen, which has no scrollback: the app scrolls its own view. There a swipe becomes the
  // mouse wheel, and xterm encodes it as the app asked: wheel reports in mouse mode, arrow
  // keys otherwise. The terminal is display-only (disableStdin), so input opens just for the
  // synchronous dispatch and whatever xterm emits goes to the PC like typed input.
  const onAltScreen = () => term.buffer.active.type === "alternate";
  const placeScroller = () => {
    // The scroller stays on top so taps never focus xterm's textarea (that pops the keyboard)
    scroller.style.overflowY = onAltScreen() ? "hidden" : "";
    scroller.style.touchAction = onAltScreen() ? "none" : "";
    screen.style.transform = "";
    follow();
  };
  term.buffer.onBufferChange(placeScroller);
  placeScroller();

  let forwarded = null; // collects what xterm emits during one toApp call
  term.onData((data) => {
    if (forwarded !== null) forwarded += data;
  });
  // Hand synthetic events to xterm with input open, so it encodes them for the app, and send
  // all of it as one INPUT: the app reads it in one go and redraws once. xterm focuses its
  // hidden textarea on mousedown; focus goes straight back so no keyboard pops.
  const toApp = (...events) => {
    const focused = document.activeElement;
    forwarded = "";
    term.options.disableStdin = false;
    try {
      events.forEach((ev) => screen.dispatchEvent(ev));
    } finally {
      term.options.disableStdin = true;
      const data = forwarded;
      forwarded = null;
      if (data && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "INPUT", data }));
      if (focused && focused !== document.body) focused.focus({ preventScroll: true });
      else term.blur();
    }
  };

  // Every wheel step makes the app redraw its whole screen on the PC and send it back, so
  // finger travel is gathered and sent at most every 50ms as one batch of steps. Apps move
  // about 3 lines per step (Claude Code, vim): a step per 3 rows of finger travel keeps the
  // content under the finger.
  let wheelPx = 0, wheelAt = null, wheelTimer = 0;
  const flushWheel = () => {
    wheelTimer = 0;
    const rh = rowHeight();
    if (!rh || !onAltScreen()) { wheelPx = 0; return; }
    const steps = Math.trunc(wheelPx / (3 * rh));
    if (!steps) return;
    wheelPx -= steps * 3 * rh;
    // One row of pixel delta per event: xterm sends one wheel report (or one arrow) for each
    const sign = Math.sign(steps);
    const events = Array.from({ length: Math.abs(steps) }, () => new WheelEvent("wheel", {
      deltaY: sign * rh * 1.001, deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      clientX: wheelAt.x, clientY: wheelAt.y, bubbles: true, cancelable: true,
    }));
    toApp(...events);
  };

  let lastY = null, startX = 0, startY = 0, startAt = 0, moved = false;
  scroller.addEventListener("touchstart", (e) => {
    if (!onAltScreen() || e.touches.length !== 1) { lastY = null; return; }
    const t = e.touches[0];
    lastY = startY = t.clientY;
    startX = t.clientX;
    startAt = performance.now();
    moved = false;
    wheelPx = 0;
  }, { passive: true });
  scroller.addEventListener("touchmove", (e) => {
    if (lastY === null || !onAltScreen()) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - startX, t.clientY - startY) > 10) moved = true;
    wheelPx += lastY - t.clientY; // finger up = content up = wheel down
    lastY = t.clientY;
    wheelAt = { x: t.clientX, y: t.clientY };
    if (!wheelTimer) wheelTimer = setTimeout(flushWheel, 50);
  }, { passive: true });
  // A short tap is a click: it picks options in the app's menus (/resume, /model, permission
  // prompts). A hold stays the long-press copy gesture.
  scroller.addEventListener("touchend", () => {
    if (lastY === null || moved || !onAltScreen() || performance.now() - startAt > 400) return;
    const at = { clientX: startX, clientY: startY, button: 0, bubbles: true, cancelable: true };
    toApp(new MouseEvent("mousedown", { ...at, buttons: 1 }), new MouseEvent("mouseup", { ...at, buttons: 0 }));
  }, { passive: true });
}

// ── Swipe a sheet down to close it ──────────────────────────────────────
// The grab handle sits in each sheet's header. Dragging the header moves the sheet with the
// finger; past 80px it closes through the sheet's own close button, so each sheet's close
// logic runs as usual. Only the header listens, so lists inside sheets scroll normally.
document.querySelectorAll(".modal-sheet").forEach((sheet) => {
  const header = sheet.querySelector(".modal-header");
  const close = sheet.querySelector('.modal-close-btn[aria-label="Close"]');
  if (!header || !close) return;
  let startY = null, dy = 0;
  header.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    dy = 0;
    sheet.style.transition = "none";
  }, { passive: true });
  header.addEventListener("touchmove", (e) => {
    if (startY === null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  const end = () => {
    if (startY === null) return;
    startY = null;
    sheet.style.transition = "transform 240ms var(--ease-out)";
    sheet.style.transform = "";
    if (dy > 80) close.click();
  };
  header.addEventListener("touchend", end, { passive: true });
  header.addEventListener("touchcancel", end, { passive: true });
});

// ── Boot ────────────────────────────────────────────────────────────────
connect();
