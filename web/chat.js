// TermPilot · Chats
// Coding agents (Claude Code, Codex, Antigravity) drawn as a chat, the way their own phone apps
// do it: the PC agent runs them over the Agent Client Protocol and relays structured updates
// (text, tool calls, diffs, permission questions) as CHAT_* messages. Loaded after app.js and
// shares its socket and helpers: ws, wsAuthed, showToast, triggerHaptic, playCompletionChime.

(() => {
  const $ = (id) => document.getElementById(id);
  const homeSessions = $("chat-sessions");
  // The chats banner stays open or folded as this phone last left it
  const chatsBanner = $("chats-banner");
  try { chatsBanner.open = localStorage.getItem("termpilot_chats_open") === "1"; } catch (e) {}
  chatsBanner.addEventListener("toggle", () => { try { localStorage.setItem("termpilot_chats_open", chatsBanner.open ? "1" : ""); } catch (e) {} });
  const chatItems = $("chat-items");
  const chatScroll = $("chat-scroll");
  const chatInput = $("chat-input");
  const chatSend = $("chat-send");
  const modeChip = $("chat-mode");

  let agents = {};          // id -> display name, only those installed on the PC
  let problems = {};        // id -> why that agent cannot start a chat now ("" when ready)
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
      // Rows rise in only on arriving home, not on every state update that redraws them
      homeSessions.classList.add("entering");
      renderHome();
      setTimeout(() => homeSessions.classList.remove("entering"), 700);
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
  const titleOf = (s) => s.title || (s.owner === "pc" ? (s.window ? "Open on the laptop" : "In the PC terminal") : "New chat");
  const folderName = (path) => (path || "").split(/[\\/]/).filter(Boolean).pop() || path;

  const handedOff = (s) => !!s.owner; // pc, moving, or taken from the PC to this phone

  function renderHome() {
    $("terminal-card-sub").textContent = $("run-prompt").textContent || "Type commands on your PC";
    renderRunning();
    const listed = sessions.filter((s) => !handedOff(s));
    // The banner sums up what is folded under it, loudest news first
    const count = (state) => listed.filter((s) => s.state === state).length;
    const needs = count("needs_you"), working = count("thinking"), n = listed.length;
    $("chats-summary").dataset.state = needs ? "needs_you" : "";
    $("chats-sub").textContent = needs ? `${needs} need${needs > 1 ? "" : "s"} your OK`
      : working ? `${working} working`
      : n ? `${n} chat${n > 1 ? "s" : ""}` : "None yet";
    if (!listed.length) {
      const empty = document.createElement("p");
      empty.className = "home-empty";
      empty.textContent = Object.keys(agents).length
        ? "No chats yet. Tap New chat and ask the AI to do something on your PC. You approve each step from here."
        : "Connect to your PC to see your chats.";
      homeSessions.replaceChildren(empty);
      return;
    }
    homeSessions.replaceChildren(...listed.map((s, i) => {
      const row = document.createElement("button");
      row.className = "home-row";
      row.dataset.state = s.state;
      row.style.setProperty("--i", i);
      const dot = document.createElement("span");
      dot.className = "state-dot";
      const text = document.createElement("span");
      text.className = "home-row-text";
      const title = document.createElement("span");
      title.className = "home-row-title";
      title.textContent = titleOf(s);
      const meta = document.createElement("span");
      meta.className = "home-row-meta";
      const where = s.owner === "pc" ? (s.window ? "On laptop" : "In PC terminal") : s.owner === "moving" ? "Moving here…" : STATE_LABEL[s.state] || ago(s.updated);
      meta.textContent = [agents[s.agent] || s.agent, folderName(s.cwd), where].filter(Boolean).join(" · ");
      text.append(title, meta);
      row.append(dot, text);
      row.addEventListener("click", () => go("#chat/" + encodeURIComponent(s.sid)));
      return row;
    }));
  }

  // ── Running on your PC: one card per session, slide it to take it over ──
  const runningCards = $("running-cards");

  function renderRunning() {
    const running = sessions.filter(handedOff);
    $("running").hidden = !running.length;
    // Never rebuild under a finger mid-slide; the next update after it lands draws the cards
    if (runningCards.querySelector(".dragging")) return;
    runningCards.replaceChildren(...running.map((s) => {
      const card = document.createElement("div");
      card.className = "run-card";
      card.dataset.owner = s.owner;
      const open = document.createElement("button");
      open.className = "run-open";
      const folder = document.createElement("span");
      folder.className = "run-folder";
      folder.textContent = folderName(s.cwd) || titleOf(s);
      const last = document.createElement("span");
      last.className = "run-last";
      last.textContent = s.owner === "phone" ? titleOf(s) : s.last || titleOf(s);
      const meta = document.createElement("span");
      meta.className = "run-meta";
      const agent = agents[s.agent] || s.agent;
      meta.textContent = s.owner === "moving" ? "Moving to your phone…"
        : s.owner === "phone" ? `${agent} · on your phone`
        : s.busy ? `${agent} · working on the PC` : `${agent} · waiting on the PC`;
      open.append(folder, last, meta);
      open.addEventListener("click", () => go("#chat/" + encodeURIComponent(s.sid)));
      const slider = $("control-slider").cloneNode(true);
      slider.removeAttribute("id");
      slider.removeAttribute("aria-labelledby");
      slider.setAttribute("aria-label", "Where " + folder.textContent + " runs");
      slider.classList.add("slider-sm");
      slider.disabled = s.owner === "moving";
      setSlider(slider, s.owner === "phone" ? "phone" : "pc");
      wireSlider(slider, (owner) => {
        const ok = send({ type: owner === "phone" ? "CHAT_TAKEOVER" : "CHAT_GIVEBACK", sid: s.sid });
        if (ok) triggerHaptic(15); else setSlider(slider, s.owner === "phone" ? "phone" : "pc");
      });
      card.append(open, slider);
      return card;
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
  // ── Home guide (the i button) ───────────────────────────────────────────
  const guideModal = $("home-guide-modal");
  const showGuide = (on) => { triggerHaptic(15); guideModal.style.display = on ? "flex" : "none"; };
  $("btn-home-guide").addEventListener("click", () => showGuide(true));
  $("home-guide-close").addEventListener("click", () => showGuide(false));
  $("home-guide-ok").addEventListener("click", () => showGuide(false));
  guideModal.addEventListener("click", (e) => { if (e.target === guideModal) showGuide(false); });

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
    const options = ids.map((id) => {
      const b = document.createElement("button");
      b.className = "agent-option";
      b.textContent = agents[id];
      b.setAttribute("aria-pressed", String(id === pickedAgent));
      if (problems[id]) b.setAttribute("aria-disabled", "true");
      b.addEventListener("click", () => { pickedAgent = id; renderAgentChoice(); });
      return b;
    });
    // A picked agent that cannot run says why, instead of failing after Start
    const problem = document.createElement("p");
    problem.className = "agent-problem";
    problem.textContent = problems[pickedAgent] || "";
    box.replaceChildren(...options, ...(problem.textContent ? [problem] : []));
    $("btn-start-chat").disabled = !pickedAgent || !dirPath || !!problems[pickedAgent];
  }

  function renderDirs(msg) {
    dirPath = msg.path;
    $("dir-path").textContent = msg.path;
    const rows = [];
    if (msg.parent) rows.push(dirRow("Up one folder", msg.parent, true));
    msg.dirs.forEach((name) => rows.push(dirRow(name, msg.path.replace(/[\\/]$/, "") + "\\" + name)));
    $("dir-list").replaceChildren(...rows);
    $("dir-list").scrollTop = 0;
    $("btn-start-chat").disabled = !pickedAgent || !dirPath || !!problems[pickedAgent];
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
    if (current !== sid) clearAttachments();
    current = sid;
    const c = chatFor(sid);
    const s = summaryOf(sid);
    if (s && (s.owner === "pc" || s.owner === "moving")) {
      c.preview = true;
      chatItems.replaceChildren(previewEl);
      previewEl.replaceChildren(listNote("Loading the latest messages…"));
      // Offline: no previewLast, so the session list every reconnect brings asks again
      c.previewLast = send({ type: "CHAT_PREVIEW", sid }, true) ? s.last : null;
      renderHeader(c);
      return;
    }
    c.preview = false;
    chatItems.replaceChildren(c.el);
    renderHeader(c);
    // Ask only for what this phone hasn't seen; a reconnect never redraws or repeats the chat
    send({ type: "CHAT_OPEN", sid, since: c.seq }, true);  // offline: onConnected asks again
    requestAnimationFrame(() => { chatScroll.scrollTop = chatScroll.scrollHeight; });
  }

  const previewEl = document.createElement("div");
  previewEl.className = "chat-log chat-preview";

  function renderPreview(items) {
    previewEl.replaceChildren(...items.map((m) => {
      const el = document.createElement("div");
      el.className = "msg msg-" + m.role;
      el.dataset.role = m.role; // agent text is parsed as Markdown, like the live chat
      el._text = m.text;
      drawText(el);
      return el;
    }));
    if (!items.length) previewEl.replaceChildren(listNote("No messages yet."));
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
    const mode = c.modes.find((m) => m.id === c.mode);
    modeChip.hidden = c.modes.length < 2;
    modeChip.textContent = mode ? mode.name : "Mode";
    // A `tp` session or a laptop window: the PC holds it until the phone takes it over
    const owner = s.owner;
    const onPc = owner === "pc" || owner === "moving";
    $("handoff-bar").hidden = !onPc;
    $("chat-input-bar").hidden = onPc;
    $("handoff-actions").hidden = owner !== "pc";
    $("handoff-text").textContent = owner === "moving"
      ? "Closing it on the PC and moving it here…"
      : `${agents[s.agent] || "The agent"} is running on your PC. Above are its latest messages, updating as it works. Take it over to continue here.`;
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
      // Each message from the phone is its own bubble, even when the agent never answered the last one
      if (!el || el.dataset.role !== role || role === "user") {
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
  // class and id are forbidden too: with them a reply could wear the page's own classes (a
  // full-screen .overlay copy of the lock screen) or hijack getElementById for real controls.
  const PURIFY = { FORBID_TAGS: ["img", "style", "form", "input", "button", "iframe", "svg", "math"], FORBID_ATTR: ["style", "class", "id"] };
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
    head.innerHTML = '<span class="tool-kind"></span><span class="tool-title"></span><span class="tool-status"></span>';
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
  // Same dictation as the terminal's mic (app.js), speaking into this composer instead
  $("chat-mic").addEventListener("click", (e) => {
    e.preventDefault();
    toggleListening(chatInput, e.currentTarget, growInput);
  });
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
    if (attached.some((a) => !a.id)) return showToast("Wait for the upload to finish");
    const text = chatInput.value.trim() || (attached.length ? "See the attached files." : "");
    if (!text) return;
    if (send({ type: "CHAT_PROMPT", sid: current, text, files: attached.map((a) => a.id) })) {
      chatInput.value = "";
      clearAttachments();
      growInput();
      triggerHaptic(10);
    }
  });

  // ── Attachments: staged on the PC now, moved into the chat's folder when the message goes ──
  const attached = [];  // {name, id}; id is set once the upload is done
  const ticketWaits = new Map();
  let nextTicket = 0;

  // A one-use upload ticket, asked for over the authenticated socket
  function uploadTicket() {
    return new Promise((resolve, reject) => {
      const rid = String(++nextTicket);
      ticketWaits.set(rid, resolve);
      if (!send({ type: "UPLOAD_TICKET", rid }, true)) { ticketWaits.delete(rid); return reject(new Error("Not connected to your PC")); }
      setTimeout(() => { if (ticketWaits.delete(rid)) reject(new Error("The PC did not answer")); }, 10000);
    });
  }
  async function upload(file) {
    if (file.size > 100 * 1024 * 1024) throw new Error(`${file.name} is over 100 MB`);
    const res = await fetch("/api/upload", {
      method: "POST", body: file,
      headers: { "X-Upload-Ticket": await uploadTicket(), "X-File-Name": encodeURIComponent(file.name), "Content-Type": "application/octet-stream" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Upload failed");
    return data;
  }
  function renderTray() {
    const tray = $("attach-tray");
    tray.hidden = !attached.length;
    tray.replaceChildren(...attached.map((a) => {
      const chip = document.createElement("span");
      chip.className = "attach-chip";
      if (!a.id) chip.dataset.busy = "";
      const name = document.createElement("span");
      name.textContent = a.id ? a.name : a.name + " ↑";
      const x = document.createElement("button");
      x.innerHTML = '<svg class="i"><use href="#i-close"/></svg>';
      x.setAttribute("aria-label", "Remove " + a.name);
      x.addEventListener("click", () => { attached.splice(attached.indexOf(a), 1); renderTray(); });
      chip.append(name, x);
      return chip;
    }));
  }
  function clearAttachments() {
    attached.length = 0;
    renderTray();
  }
  $("chat-attach").addEventListener("click", () => $("attach-input").click());
  $("attach-input").addEventListener("change", (e) => {
    [...e.target.files].slice(0, 10 - attached.length).forEach((file) => {
      const a = { name: file.name, id: null };
      attached.push(a);
      upload(file).then((d) => { a.id = d.id; a.name = d.name; renderTray(); })
        .catch((err) => { const i = attached.indexOf(a); if (i >= 0) attached.splice(i, 1); renderTray(); showToast(err.message); });
    });
    e.target.value = "";
    renderTray();
  });

  // ── List sheet: files in the chat's folder, past sessions, devices ──────
  const listModal = $("list-modal");
  const listBody = $("list-body");
  const listPreview = $("list-preview");
  let listKind = null;

  function openList(kind, title, msg) {
    if (!send(msg)) return;
    listKind = kind;
    $("list-title").textContent = title;
    listPreview.hidden = true;
    listPreview.replaceChildren();
    listBody.replaceChildren(listNote("Loading…"));
    listModal.style.display = "flex";
  }
  function closeList() {
    listModal.style.display = "none";
    listKind = null;
    listPreview.replaceChildren();  // stops a playing video
  }
  $("list-close").addEventListener("click", closeList);
  listModal.addEventListener("click", (e) => { if (e.target === listModal) closeList(); });
  function listNote(text) {
    const p = document.createElement("p");
    p.className = "home-empty";
    p.textContent = text;
    return p;
  }
  function listRow(title, sub, onClick, action) {
    const row = document.createElement(onClick ? "button" : "div");
    row.className = "list-row";
    const text = document.createElement("span");
    text.className = "list-row-text";
    const b = document.createElement("b");
    b.textContent = title;
    const small = document.createElement("small");
    small.textContent = sub;
    text.append(b, small);
    row.append(text);
    if (action) row.append(action);
    if (onClick) row.addEventListener("click", onClick);
    return row;
  }
  const size = (n) => n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB";

  $("btn-files").addEventListener("click", () => {
    const s = current && summaryOf(current);
    if (s) openList("files", "Files in " + folderName(s.cwd), { type: "CHAT_FILES", sid: current });
  });
  function renderFiles(list) {
    listBody.replaceChildren(...(list.length ? list.map((f) => listRow(f.path, [f.kind, size(f.size), ago(f.modified)].join(" · "),
      () => send({ type: "CHAT_FILE", sid: current, path: f.path }))) : [listNote("No images, videos, PDFs or documents in this folder yet.")]));
  }
  function showFile(msg) {
    const ext = (msg.path.split(".").pop() || "").toLowerCase();
    const kind = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext) ? "img"
      : ["mp4", "mov", "webm", "m4v"].includes(ext) ? "video" : ["mp3", "wav", "m4a"].includes(ext) ? "audio" : null;
    const parts = [];
    if (kind) {
      const media = document.createElement(kind);
      media.src = msg.url;
      if (kind !== "img") { media.controls = true; media.playsInline = true; }
      else media.alt = msg.path;
      parts.push(media);
    }
    const actions = document.createElement("div");
    actions.className = "ask-options";
    const link = (label, href, download) => {
      const a = document.createElement("a");
      a.className = "ask-btn";
      a.textContent = label;
      a.href = href;
      if (download) a.download = folderName(msg.path); else { a.target = "_blank"; a.rel = "noopener"; }
      return a;
    };
    actions.append(link("Open", msg.url), link("Download", msg.url + "?download=1", true));
    parts.push(actions);
    listPreview.replaceChildren(...parts);
    listPreview.hidden = false;
  }

  $("btn-history").addEventListener("click", () => openList("history", "Earlier chats", { type: "CHAT_HISTORY" }));
  function renderHistory(items) {
    listBody.replaceChildren(...(items.length ? items.map((h) => listRow(h.title, [agents[h.agent] || h.agent, folderName(h.cwd), ago(h.updated)].join(" · "), () => {
      if (!send({ type: "CHAT_RESUME", agent: h.agent, sid: h.sid })) return;
      startingNew = true;
      closeList();
      showToast("Opening…");
    })) : [listNote("No other Claude Code or Codex sessions on this PC.")]));
  }

  $("btn-devices").addEventListener("click", () => openList("devices", "Devices", { type: "DEVICES" }));
  function renderDevices(devices) {
    listBody.replaceChildren(...devices.map((d) => {
      // Two taps, so a stray one never locks a phone out
      const remove = document.createElement("button");
      remove.className = "ask-btn reject_once";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        if (remove.dataset.armed) return send({ type: "DEVICE_REVOKE", id: d.id });
        remove.dataset.armed = "1";
        remove.textContent = d.current ? "Remove this phone?" : "Tap to confirm";
      });
      return listRow(d.name, d.current ? "This phone" : ago(d.seen) === "now" ? "Used just now" : "Last used " + ago(d.seen) + " ago", null, remove);
    }));
  }
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
        problems = msg.problems || {};
        sessions = msg.sessions || [];
        sessions.forEach((s) => { const k = chats.get(s.sid); if (k) k.state = s.state; });
        if (document.body.dataset.view === "home") renderHome();
        if (newModal.style.display === "flex") renderAgentChoice();
        if (current) {
          // Taken over (or given back) while open: swap the preview and the live chat
          const k = chatFor(current), s = summaryOf(current);
          const held = !!s && (s.owner === "pc" || s.owner === "moving");
          if (held !== !!k.preview) openChat(current);
          else {
            renderHeader(k);
            // Watching a session the PC holds: its card's latest reply moved on, so fetch the messages again
            if (held && s.last !== k.previewLast) {
              k.previewLast = s.last;
              send({ type: "CHAT_PREVIEW", sid: current }, true);
            }
          }
        }
        break;
      case "CHAT_PREVIEW":
        if (msg.sid === current && c.preview) renderPreview(msg.items || []);
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
      case "AGENT_ONLINE":
        // The PC agent restarted: reload the list and whatever chat is open
        send({ type: "CHAT_LIST" }, true);
        if (current) send({ type: "CHAT_OPEN", sid: current, since: chatFor(current).seq }, true);
        break;
      case "UPLOAD_TICKET": {
        const resolve = ticketWaits.get(msg.rid);
        ticketWaits.delete(msg.rid);
        if (resolve) resolve(msg.ticket);
        break;
      }
      case "CHAT_FILES":
        if (listKind === "files" && msg.sid === current) renderFiles(msg.files || []);
        break;
      case "CHAT_FILE_URL":
        if (listKind === "files" && msg.sid === current) showFile(msg);
        break;
      case "CHAT_HISTORY":
        if (listKind === "history") renderHistory(msg.items || []);
        break;
      case "DEVICES":
        if (listKind === "devices") renderDevices(msg.devices || []);
        break;
      case "CHAT_ERROR":
        if (c && c.sid === current && !c.preview) {
          const err = document.createElement("div");
          err.className = "msg msg-error";
          err.textContent = msg.msg;
          c.el.append(err);
          keepBottom(c, true);
        } else showToast(msg.msg);
        if (startingNew && (!c || c.sid !== current)) startingNew = false;
        // A refused take over: put the card's slider back where the session really is
        if (document.body.dataset.view === "home") renderHome();
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
