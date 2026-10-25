// TermPilot · Chats
// Coding agents (Claude Code, Codex, Gemini CLI) drawn as a chat, the way their own phone apps
// do it: the PC agent runs them over the Agent Client Protocol and relays structured updates
// (text, tool calls, diffs, permission questions) as CHAT_* messages. Loaded after app.js and
// shares its socket and helpers: ws, wsAuthed, showToast, triggerHaptic, playCompletionChime.

(() => {
  const $ = (id) => document.getElementById(id);
  const homeSessions = $("chat-sessions");
  const chatItems = $("chat-items");
  const chatScroll = $("chat-scroll");
  const chatInput = $("chat-input");
  const chatSend = $("chat-send");
  const modeChip = $("chat-mode");

  let agents = {};          // id -> display name, only those installed on the PC
  let sessions = [];        // summaries from CHAT_SESSIONS
  let current = null;       // sid of the open chat
  let startingNew = false;  // waiting for CHAT_CREATED from our own New chat
  const chats = new Map();  // sid -> chat state and its DOM

  const KIND_LABEL = { read: "Read", edit: "Edit", delete: "Delete", move: "Move", search: "Search",
                       execute: "Run", think: "Think", fetch: "Fetch", switch_mode: "Mode", other: "Tool" };
  const STATE_LABEL = { idle: "", thinking: "Working", needs_you: "Needs you", error: "Stopped" };

  function send(msg, quiet = false) {
    if (ws && ws.readyState === WebSocket.OPEN && wsAuthed) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    if (!quiet) showToast("Not connected to your PC");
    return false;
  }

  function chatFor(sid) {
    let c = chats.get(sid);
    if (!c) {
      const el = document.createElement("div");
      el.className = "chat-log";
      c = { sid, el, seq: 0, tools: new Map(), plan: null, pending: new Map(), state: "idle", modes: [], mode: null };
      chats.set(sid, c);
    }
    return c;
  }

  function summaryOf(sid) {
    return sessions.find((s) => s.sid === sid);
  }

  // ── Views: home (chat list), one chat, the terminal ─────────────────────
  // The hash carries the view so the phone's back gesture works: #chat/<sid>, #terminal, or home.
  let pushed = false;
  function go(hash) {
    pushed = true;
    location.hash = hash;
  }
  function goHome() {
    if (pushed) { pushed = false; history.back(); }
    else location.replace("#");
  }
  function route() {
    const m = location.hash.match(/^#chat\/(.+)$/);
    if (location.hash === "#terminal") {
      document.body.dataset.view = "terminal";
      current = null;
    } else if (m) {
      document.body.dataset.view = "chat";
      openChat(decodeURIComponent(m[1]));
    } else {
      document.body.dataset.view = "home";
      current = null;
      renderHome();
    }
  }
  window.addEventListener("hashchange", route);
  document.querySelectorAll("[data-go-home]").forEach((b) => b.addEventListener("click", goHome));
  $("open-terminal").addEventListener("click", () => go("#terminal"));

  // ── Home ────────────────────────────────────────────────────────────────

  function ago(seconds) {
    const s = Date.now() / 1000 - seconds;
    if (s < 60) return "now";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }
  const titleOf = (s) => s.title || (s.owner === "pc" ? "In the PC terminal" : "New chat");
  const folderName = (path) => (path || "").split(/[\\/]/).filter(Boolean).pop() || path;

  function renderHome() {
    $("terminal-card-sub").textContent = $("run-prompt").textContent || "PowerShell on your PC";
    if (!sessions.length) {
      const empty = document.createElement("p");
      empty.className = "home-empty";
      empty.textContent = Object.keys(agents).length
        ? "No chats yet. Start one and the agent works on your PC while you watch and approve from here."
        : "Connect to your PC to see your chats.";
      homeSessions.replaceChildren(empty);
      return;
    }
    homeSessions.replaceChildren(...sessions.map((s) => {
      const row = document.createElement("button");
      row.className = "home-row";
      row.dataset.state = s.state;
      const dot = document.createElement("span");
      dot.className = "state-dot";
      const text = document.createElement("span");
      text.className = "home-row-text";
      const title = document.createElement("span");
      title.className = "home-row-title";
      title.textContent = titleOf(s);
      const meta = document.createElement("span");
      meta.className = "home-row-meta";
      const where = s.owner === "pc" ? "In PC terminal" : s.owner === "moving" ? "Moving here…" : STATE_LABEL[s.state] || ago(s.updated);
      meta.textContent = [agents[s.agent] || s.agent, folderName(s.cwd), where].filter(Boolean).join(" · ");
      text.append(title, meta);
      row.append(dot, text);
      row.addEventListener("click", () => go("#chat/" + encodeURIComponent(s.sid)));
      return row;
    }));
  }

  // ── New chat sheet: pick an agent and a folder ──────────────────────────
  const newModal = $("new-chat-modal");
  let pickedAgent = localStorage.getItem("termpilot_chat_agent");
  let dirPath = null;

  function openNewChat() {
    newModal.style.display = "flex";
    renderAgentChoice();
    if (send({ type: "CHAT_LIST" })) send({ type: "CHAT_DIRS", path: localStorage.getItem("termpilot_chat_dir") || "" });
  }
  function closeNewChat() {
    newModal.style.display = "none";
  }
  $("btn-new-chat").addEventListener("click", openNewChat);
  $("new-chat-close").addEventListener("click", closeNewChat);
  newModal.addEventListener("click", (e) => { if (e.target === newModal) closeNewChat(); });

  function renderAgentChoice() {
    const ids = Object.keys(agents);
    if (!ids.includes(pickedAgent)) pickedAgent = ids[0] || null;
    const box = $("agent-choice");
    if (!ids.length) {
      box.textContent = "No chat-ready agents on this PC yet. Install the adapters with: npm ci --prefix desktop-agent/acp";
      return;
    }
    box.replaceChildren(...ids.map((id) => {
      const b = document.createElement("button");
      b.className = "agent-option";
      b.textContent = agents[id];
      b.setAttribute("aria-pressed", String(id === pickedAgent));
      b.addEventListener("click", () => { pickedAgent = id; renderAgentChoice(); });
      return b;
    }));
    $("btn-start-chat").disabled = !pickedAgent || !dirPath;
  }

  function renderDirs(msg) {
    dirPath = msg.path;
    $("dir-path").textContent = msg.path;
    const rows = [];
    if (msg.parent) rows.push(dirRow("Up one folder", msg.parent, true));
    msg.dirs.forEach((name) => rows.push(dirRow(name, msg.path.replace(/[\\/]$/, "") + "\\" + name)));
    $("dir-list").replaceChildren(...rows);
    $("dir-list").scrollTop = 0;
    $("btn-start-chat").disabled = !pickedAgent || !dirPath;
  }
  function dirRow(label, path, up = false) {
    const b = document.createElement("button");
    b.className = "dir-row" + (up ? " up" : "");
    b.textContent = label;
    b.addEventListener("click", () => send({ type: "CHAT_DIRS", path }));
    return b;
  }

  $("btn-start-chat").addEventListener("click", () => {
    if (!pickedAgent || !dirPath) return;
    if (!send({ type: "CHAT_NEW", agent: pickedAgent, cwd: dirPath })) return;
    localStorage.setItem("termpilot_chat_agent", pickedAgent);
    localStorage.setItem("termpilot_chat_dir", dirPath);
    startingNew = true;
    closeNewChat();
    showToast(`Starting ${agents[pickedAgent]}…`);
  });

  // ── One chat ────────────────────────────────────────────────────────────

  function openChat(sid) {
    current = sid;
    const c = chatFor(sid);
    chatItems.replaceChildren(c.el);
    renderHeader(c);
    // Ask only for what this phone hasn't seen; a reconnect never redraws or repeats the chat
    send({ type: "CHAT_OPEN", sid, since: c.seq }, true);  // offline: onConnected asks again
    requestAnimationFrame(() => { chatScroll.scrollTop = chatScroll.scrollHeight; });
  }

  function renderHeader(c) {
    const s = summaryOf(c.sid) || {};
    $("chat-agent").textContent = agents[s.agent] || s.agent || "Chat";
    $("chat-status").textContent = STATE_LABEL[c.state] || folderName(s.cwd) || "";
    $("chat-title").textContent = titleOf(s);
    $("chat-view").dataset.state = c.state;
    const busy = c.state === "thinking" || c.state === "needs_you";
    chatSend.classList.toggle("stop", busy);
    chatSend.setAttribute("aria-label", busy ? "Stop" : "Send");
    chatSend.querySelector("use").setAttribute("href", busy ? "#i-stop" : "#i-send");
    const mode = c.modes.find((m) => m.id === c.mode);
    modeChip.hidden = c.modes.length < 2;
    modeChip.textContent = mode ? mode.name : "Mode";
    // A `tp` session: the PC terminal holds it until the phone takes it over
    const owner = s.owner;
    const onPc = owner === "pc" || owner === "moving";
    $("handoff-bar").hidden = !onPc;
    $("chat-input-bar").hidden = onPc;
    $("handoff-actions").hidden = owner !== "pc";
    $("handoff-text").textContent = owner === "moving"
      ? "Closing it on the PC and moving it here…"
      : `${agents[s.agent] || "The agent"} is running in the PC terminal. Watch it there, or take it over to continue here as a chat.`;
    $("btn-giveback").hidden = owner !== "phone";
    if (onPc) modeChip.hidden = true;
  }

  function nearBottom() {
    return chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 80;
  }
  function keepBottom(c, wasNear) {
    if (c.sid === current && wasNear) chatScroll.scrollTop = chatScroll.scrollHeight;
  }

  function reset(c) {
    c.el.replaceChildren();
    c.seq = 0;
    c.tools.clear();
    c.plan = null;
  }

  // One update from the agent, as ACP's session/update describes it
  function apply(c, [seq, u]) {
    if (seq <= c.seq) return;
    c.seq = seq;
    const kind = u.sessionUpdate;
    if (kind === "user_message_chunk" || kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
      const role = kind === "user_message_chunk" ? "user" : kind === "agent_thought_chunk" ? "thought" : "agent";
      const text = u.content && u.content.type === "text" ? u.content.text : "";
      let el = c.el.lastElementChild;
      if (!el || el.dataset.role !== role) {
        el = document.createElement("div");
        el.className = "msg msg-" + role;
        el.dataset.role = role;
        el._text = "";
        c.el.append(el);
      }
      el._text += text;
      drawText(el);
    } else if (kind === "tool_call" || kind === "tool_call_update") {
      const card = toolCard(c, u.toolCallId);
      for (const [k, v] of Object.entries(u)) if (v !== undefined && v !== null) card._data[k] = v;
      drawTool(card);
    } else if (kind === "plan") {
      if (!c.plan) {
        c.plan = document.createElement("div");
        c.plan.className = "plan";
        c.el.append(c.plan);
      }
      drawPlan(c.plan, u.entries || []);
    }
  }

  // Markdown is parsed once per frame however many chunks arrive, then sanitised: agent text
  // can quote anything, including HTML from a web page it fetched.
  const dirtyText = new Set();
  let textFrame = 0;
  function drawText(el) {
    dirtyText.add(el);
    if (!textFrame) textFrame = requestAnimationFrame(flushText);
  }
  function flushText() {
    textFrame = 0;
    const wasNear = nearBottom();
    dirtyText.forEach((el) => {
      if (el.dataset.role === "agent" && window.marked && window.DOMPurify) {
        el.innerHTML = DOMPurify.sanitize(marked.parse(el._text, { gfm: true, breaks: true }), PURIFY);
      } else if (el.dataset.role === "thought") {
        el.replaceChildren(thoughtBox(el._text, el.querySelector("details")?.open));
      } else {
        el.textContent = el._text;
      }
    });
    dirtyText.clear();
    if (current) keepBottom(chatFor(current), wasNear);
  }
  const PURIFY = { FORBID_TAGS: ["img", "style", "form", "input", "button", "iframe", "svg", "math"], FORBID_ATTR: ["style"] };
  if (window.DOMPurify) {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
    });
  }
  function thoughtBox(text, open) {
    const d = document.createElement("details");
    d.open = !!open;
    const s = document.createElement("summary");
    s.textContent = "Thinking";
    const p = document.createElement("p");
    p.textContent = text;
    d.append(s, p);
    return d;
  }

  function toolCard(c, id) {
    let card = c.tools.get(id);
    if (card) return card;
    card = document.createElement("div");
    card.className = "tool";
    card._data = {};
    const head = document.createElement("button");
    head.className = "tool-head";
    head.setAttribute("aria-expanded", "false");
    head.innerHTML = '<span class="tool-kind"></span><span class="tool-title"></span><span class="tool-status" aria-hidden="true"></span>';
    const body = document.createElement("div");
    body.className = "tool-body";
    body.hidden = true;
    const ask = document.createElement("div");
    ask.className = "tool-ask";
    ask.hidden = true;
    head.addEventListener("click", () => {
      body.hidden = !body.hidden;
      head.setAttribute("aria-expanded", String(!body.hidden));
    });
    card.append(head, body, ask);
    c.tools.set(id, card);
    c.el.append(card);
    return card;
  }

  function drawTool(card) {
    const d = card._data;
    card.dataset.status = d.status || "pending";
    card.querySelector(".tool-kind").textContent = KIND_LABEL[d.kind] || "Tool";
    card.querySelector(".tool-title").textContent = d.title || "Working";
    const parts = toolBody(d);
    const body = card.querySelector(".tool-body");
    body.replaceChildren(...parts);
    card.classList.toggle("empty", !parts.length);
    // Edits open on their own: the change is what you want to see. Other tools stay one line.
    if (!card._opened && (d.content || []).some((x) => x.type === "diff")) {
      card._opened = true;
      body.hidden = false;
      card.querySelector(".tool-head").setAttribute("aria-expanded", "true");
    }
  }

  function clip(text, max = 4000) {
    return text.length > max ? text.slice(0, max) + `\n… ${text.length - max} more characters` : text;
  }
  function pre(text, cls = "") {
    const p = document.createElement("pre");
    p.className = "tool-pre " + cls;
    p.textContent = clip(text);
    return p;
  }

  function toolBody(d) {
    const out = [];
    const input = d.rawInput || {};
    if (typeof input.command === "string") out.push(pre("$ " + input.command, "cmd"));
    let hasText = false;
    (d.content || []).forEach((item) => {
      if (item.type === "diff") out.push(diffView(item.path, item.oldText, item.newText));
      else if (item.type === "content" && item.content && item.content.type === "text" && item.content.text) {
        hasText = true;
        out.push(pre(item.content.text));
      }
    });
    if (!hasText && d.kind === "execute" && typeof d.rawOutput === "string" && d.rawOutput) out.push(pre(d.rawOutput));
    return out;
  }

  // Line diff: longest common subsequence on modest files, plain old/new beyond that
  function diffLines(a, b) {
    if (a.length * b.length > 250000) return [...a.map((t) => ["-", t]), ...b.map((t) => ["+", t])];
    const n = a.length, m = b.length;
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push([" ", a[i]]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) out.push(["-", a[i++]]);
      else out.push(["+", b[j++]]);
    }
    while (i < n) out.push(["-", a[i++]]);
    while (j < m) out.push(["+", b[j++]]);
    return out;
  }

  function diffView(path, oldText, newText) {
    const box = document.createElement("div");
    box.className = "diff";
    const name = document.createElement("div");
    name.className = "diff-path";
    name.textContent = folderName(path) || "file";
    name.title = path || "";
    box.append(name);
    const lines = diffLines(oldText ? oldText.split("\n") : [], (newText || "").split("\n"));
    const code = document.createElement("div");
    code.className = "diff-code";
    let shown = 0;
    for (let k = 0; k < lines.length && shown < 400; k++) {
      // Long unchanged stretches fold to one line, keeping 2 lines of context each side
      if (lines[k][0] === " ") {
        let end = k;
        while (end < lines.length && lines[end][0] === " ") end++;
        const run = end - k;
        if (run > 6) {
          const keepTop = k === 0 ? 0 : 2, keepBottom = end === lines.length ? 0 : 2;
          for (let t = 0; t < keepTop; t++) code.append(diffLine(lines[k + t]));
          const fold = document.createElement("div");
          fold.className = "diff-fold";
          fold.textContent = `⋯ ${run - keepTop - keepBottom} unchanged lines`;
          code.append(fold);
          for (let t = end - keepBottom; t < end; t++) code.append(diffLine(lines[t]));
          shown += keepTop + keepBottom + 1;
          k = end - 1;
          continue;
        }
      }
      code.append(diffLine(lines[k]));
      shown++;
    }
    if (shown >= 400) {
      const more = document.createElement("div");
      more.className = "diff-fold";
      more.textContent = "⋯ more changes";
      code.append(more);
    }
    box.append(code);
    return box;
  }
  function diffLine([sign, text]) {
    const row = document.createElement("div");
    row.className = "diff-line" + (sign === "+" ? " add" : sign === "-" ? " del" : "");
    row.textContent = sign + " " + text;
    return row;
  }

  function drawPlan(el, entries) {
    const title = document.createElement("div");
    title.className = "plan-title";
    title.textContent = "Plan";
    el.replaceChildren(title, ...entries.map((e) => {
      const row = document.createElement("div");
      row.className = "plan-row";
      row.dataset.status = e.status || "pending";
      row.textContent = e.content || "";
      return row;
    }));
  }

  // ── Permission questions ────────────────────────────────────────────────
  const OPTION_ORDER = { allow_once: 0, allow_always: 1, reject_once: 2, reject_always: 3 };

  function showAsk(c, rid, toolCall, options) {
    toolCall = toolCall || {};
    const card = toolCard(c, toolCall.toolCallId || "ask-" + rid);
    for (const [k, v] of Object.entries(toolCall)) if (v !== undefined && v !== null && !(k in card._data)) card._data[k] = v;
    drawTool(card);
    c.pending.set(rid, card);
    const ask = card.querySelector(".tool-ask");
    const q = document.createElement("p");
    q.className = "ask-q";
    q.textContent = "Allow this?";
    const row = document.createElement("div");
    row.className = "ask-options";
    [...options].sort((a, b) => (OPTION_ORDER[a.kind] ?? 9) - (OPTION_ORDER[b.kind] ?? 9)).forEach((o) => {
      const b = document.createElement("button");
      b.className = "ask-btn " + (o.kind || "");
      b.textContent = o.name || o.optionId;
      b.addEventListener("click", () => {
        if (!send({ type: "CHAT_ANSWER", sid: c.sid, rid, optionId: o.optionId })) return;
        row.querySelectorAll("button").forEach((x) => (x.disabled = true));
        triggerHaptic(10);
      });
      row.append(b);
    });
    ask.replaceChildren(q, row);
    ask.hidden = false;
    card.classList.add("asking");
  }
  function clearAsk(c, rid) {
    const card = c.pending.get(rid);
    c.pending.delete(rid);
    if (!card) return;
    card.querySelector(".tool-ask").hidden = true;
    card.classList.remove("asking");
  }

  // ── Composer ────────────────────────────────────────────────────────────

  function growInput() {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(Math.max(chatInput.scrollHeight, 48), 140) + "px";
  }
  chatInput.addEventListener("input", growInput);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      chatSend.click();
    }
  });
  chatSend.addEventListener("click", () => {
    if (!current) return;
    const c = chatFor(current);
    if (c.state === "thinking" || c.state === "needs_you") {
      send({ type: "CHAT_CANCEL", sid: current });
      return;
    }
    const text = chatInput.value.trim();
    if (!text) return;
    if (send({ type: "CHAT_PROMPT", sid: current, text })) {
      chatInput.value = "";
      growInput();
      triggerHaptic(10);
    }
  });
  $("btn-watch").addEventListener("click", () => go("#terminal"));
  $("btn-takeover").addEventListener("click", () => {
    if (current && send({ type: "CHAT_TAKEOVER", sid: current })) triggerHaptic(15);
  });
  $("btn-giveback").addEventListener("click", () => {
    if (current && send({ type: "CHAT_GIVEBACK", sid: current })) showToast("Back in the PC terminal");
  });
  modeChip.addEventListener("click", () => {
    const c = current && chatFor(current);
    if (!c || c.modes.length < 2) return;
    const i = c.modes.findIndex((m) => m.id === c.mode);
    send({ type: "CHAT_MODE", sid: c.sid, modeId: c.modes[(i + 1) % c.modes.length].id });
  });

  // ── Messages from the PC ────────────────────────────────────────────────

  function setState(c, state, reason) {
    const was = c.state;
    c.state = state;
    const s = summaryOf(c.sid);
    if (s) s.state = state;
    if (c.sid === current) renderHeader(c);
    if (document.body.dataset.view === "home") renderHome();
    if (state === "needs_you" && was !== "needs_you") { playCompletionChime(); triggerHaptic([20, 60, 20]); }
    else if (state === "idle" && was === "thinking" && reason === "end_turn") { playCompletionChime(); triggerHaptic(20); }
  }

  function onMessage(msg) {
    const c = typeof msg.sid === "string" ? chatFor(msg.sid) : null;
    switch (msg.type) {
      case "CHAT_SESSIONS":
        agents = msg.agents || {};
        sessions = msg.sessions || [];
        sessions.forEach((s) => { const k = chats.get(s.sid); if (k) k.state = s.state; });
        if (document.body.dataset.view === "home") renderHome();
        if (newModal.style.display === "flex") renderAgentChoice();
        if (current) renderHeader(chatFor(current));
        break;
      case "CHAT_DIRS":
        renderDirs(msg);
        break;
      case "CHAT_CREATED":
        if (startingNew) { startingNew = false; go("#chat/" + encodeURIComponent(msg.sid)); }
        break;
      case "CHAT_SYNC": {
        const wasNear = nearBottom();
        // From 0 means the PC replays the whole chat (it may have reopened it): start clean
        if (msg.first && msg.since === 0 && c.seq > 0) reset(c);
        msg.events.forEach((e) => apply(c, e));
        if (!msg.more) {
          c.modes = msg.modes || [];
          c.mode = msg.mode;
          [...c.pending.keys()].forEach((rid) => clearAsk(c, rid));
          (msg.pending || []).forEach((p) => showAsk(c, p.rid, p.toolCall, p.options || []));
          if (msg.summary) {
            const i = sessions.findIndex((s) => s.sid === msg.sid);
            if (i >= 0) sessions[i] = msg.summary; else sessions.unshift(msg.summary);
            c.state = msg.summary.state;
          }
          if (c.sid === current) renderHeader(c);
        }
        keepBottom(c, wasNear);
        break;
      }
      case "CHAT_EVENT": {
        const wasNear = nearBottom();
        msg.events.forEach((e) => apply(c, e));
        keepBottom(c, wasNear);
        break;
      }
      case "CHAT_PERMISSION": {
        const wasNear = nearBottom();
        showAsk(c, msg.rid, msg.toolCall, msg.options || []);
        keepBottom(c, wasNear);
        break;
      }
      case "CHAT_ANSWERED":
        clearAsk(c, msg.rid);
        break;
      case "CHAT_STATE":
        setState(c, msg.state, msg.reason);
        if (msg.state !== "needs_you") [...c.pending.keys()].forEach((rid) => clearAsk(c, rid));
        break;
      case "CHAT_MODE":
        c.modes = msg.modes || [];
        c.mode = msg.mode;
        if (c.sid === current) renderHeader(c);
        break;
      case "CHAT_ERROR":
        if (c && c.sid === current) {
          const err = document.createElement("div");
          err.className = "msg msg-error";
          err.textContent = msg.msg;
          c.el.append(err);
          keepBottom(c, true);
        } else showToast(msg.msg);
        if (startingNew && !c) startingNew = false;
        break;
    }
  }

  // ── Alerts: push notifications while TermPilot is closed or the phone is locked ──
  // The relay sends one when an agent needs an answer, finishes, or stops, but only while
  // no phone has TermPilot on screen (VISIBLE).
  const alertsRow = $("alerts-row");
  const canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // iPhone offers push only to sites opened from the Home Screen
  const needsHomeScreen = !canPush && /iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone;
  const swReady = canPush ? navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready) : null;
  let pushKey = null;

  function renderAlerts() {
    alertsRow.hidden = !(needsHomeScreen || (canPush && pushKey && Notification.permission === "default"));
    if (needsHomeScreen) $("alerts-sub").textContent = "On iPhone, add TermPilot to your Home Screen first";
  }

  const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));

  async function subscribe() {
    const reg = await swReady;
    let sub = await reg.pushManager.getSubscription();
    // A new relay key (push.json deleted) makes the old subscription useless
    if (sub && localStorage.getItem("termpilot_push_key") !== pushKey) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(pushKey) });
    localStorage.setItem("termpilot_push_key", pushKey);
    send({ type: "PUSH_SUBSCRIBE", sub: sub.toJSON() }, true);
  }

  alertsRow.addEventListener("click", async () => {
    if (needsHomeScreen) return showToast("Tap Share, then Add to Home Screen, and open TermPilot from there");
    try {
      if (await Notification.requestPermission() === "granted") { await subscribe(); showToast("Alerts on"); }
      else showToast("Alerts are blocked in this browser's site settings");
    } catch (e) {
      showToast("Could not turn on alerts: " + e.message);
    }
    renderAlerts();
  });

  const reportVisible = () => send({ type: "VISIBLE", visible: document.visibilityState === "visible" }, true);
  document.addEventListener("visibilitychange", reportVisible);
  // A tapped alert asks the already open page to show its chat
  navigator.serviceWorker?.addEventListener("message", (e) => {
    if (e.data?.type === "OPEN") location.hash = new URL(e.data.url).hash;
  });

  function onConnected(auth) {
    send({ type: "CHAT_LIST" });
    if (current) send({ type: "CHAT_OPEN", sid: current, since: chatFor(current).seq });
    reportVisible();
    pushKey = auth?.push_key || null;
    renderAlerts();
    // Re-sent on every connect: the relay may have lost it, or the browser rotated it
    if (pushKey && canPush && Notification.permission === "granted") subscribe().catch(() => {});
  }

  window.Chat = { onMessage, onConnected };
  route();
})();
