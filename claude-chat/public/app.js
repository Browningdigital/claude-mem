// ===== State =====
let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let images = [];
let streaming = false;
let currentEl = null;
let textBuf = "";
let sessionId = null;
let connected = false;
let serverCwd = "";
let sessions = [];
let refreshInterval = null;
let view = "sessions"; // "sessions" or "chat"

// ===== DOM refs =====
const $ = (s) => document.querySelector(s);
const messages = $("#messages");
const input = $("#input");
const sendBtn = $("#send-btn");
const stopBtn = $("#stop-btn");
const strip = $("#image-strip");
const sessionList = $("#session-list");
const statusDot = $("#status-dot");
const statusText = $("#status-text");
const cwdInput = $("#cwd-input");
const topSession = $("#topbar-session");
const sessionPanel = $("#session-panel");
const chatPanel = $("#chat-panel");

// ===== Init =====
marked.setOptions({
  highlight: (code, lang) =>
    lang && hljs.getLanguage(lang)
      ? hljs.highlight(code, { language: lang }).value
      : hljs.highlightAuto(code).value,
  breaks: true,
  gfm: true,
});

connect();
loadSessions();
checkHealth();
updateSend();

// Auto-refresh sessions every 15 seconds
refreshInterval = setInterval(() => {
  if (view === "sessions") loadSessions();
}, 15000);

// ===== Health check =====
async function checkHealth() {
  try {
    const res = await fetch("/api/ping");
    const data = await res.json();
    if (!data.claude) {
      const banner = document.createElement("div");
      banner.className = "error-banner";
      banner.innerHTML = `
        <strong>Claude Code CLI not found</strong>
        <p>${data.claudeError || "Install with: npm i -g @anthropic-ai/claude-code"}</p>
      `;
      document.querySelector(".app").prepend(banner);
      input.disabled = true;
    }
  } catch {}
}

// ===== WebSocket =====
function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  statusText.textContent = "Connecting...";
  statusDot.classList.remove("connected", "busy");

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  try { ws = new WebSocket(`${proto}//${location.host}/ws`); }
  catch { scheduleReconnect(); return; }

  ws.onopen = () => {
    connected = true;
    reconnectDelay = 1000;
    statusDot.classList.add("connected");
    statusText.textContent = "Connected";
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (sessionId) ws.send(JSON.stringify({ type: "setSession", sessionId }));
  };

  ws.onclose = () => {
    connected = false;
    statusDot.classList.remove("connected", "busy");
    statusText.textContent = "Disconnected";
    scheduleReconnect();
  };

  ws.onerror = () => {};
  ws.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch {} };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

function forceReconnect() {
  if (connected) return;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectDelay = 1000;
  if (ws) { try { ws.close(); } catch {} ws = null; }
  connect();
}

setInterval(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) { if (!reconnectTimer) connect(); }
}, 30000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && (!ws || ws.readyState !== WebSocket.OPEN)) forceReconnect();
});

// ===== Event handler =====
function handleEvent(ev) {
  if (ev.type === "connected") {
    if (ev.cwd && !cwdInput.value) { serverCwd = ev.cwd; cwdInput.value = ev.cwd; }
    return;
  }

  if (ev.type === "thinking") {
    setStreaming(true);
    killThinking();
    messages.insertAdjacentHTML("beforeend", `
      <div class="thinking-row" id="thinking">
        <div class="dots"><span></span><span></span><span></span></div>
        <span>Thinking...</span>
      </div>
    `);
    scroll();
    return;
  }

  if (ev.type === "stream_event") {
    const e = ev.event;
    if (e?.type === "message_start") { killThinking(); ensureBubble(); }
    if (e?.type === "content_block_delta" && e?.delta?.type === "text_delta") {
      killThinking(); ensureBubble();
      textBuf += e.delta.text;
      renderBubble(); scroll();
    }
    if (e?.type === "content_block_start" && e?.content_block?.type === "tool_use") {
      killThinking(); ensureBubble();
      const name = e.content_block.name || "Tool";
      const t = document.createElement("span");
      t.className = "tool-ind";
      t.innerHTML = `<span class="spin"></span>${esc(name)}`;
      currentEl.querySelector(".msg-body").appendChild(t);
      scroll();
    }
    if (e?.type === "content_block_stop" && currentEl) {
      const pending = currentEl.querySelectorAll(".tool-ind:not(.done)");
      if (pending.length) pending[pending.length - 1].classList.add("done");
    }
  }

  if (ev.session_id && ev.session_id !== sessionId) {
    sessionId = ev.session_id;
    topSession.textContent = sessionId.slice(0, 8);
  }

  if (ev.type === "done") { killThinking(); setStreaming(false); }
  if (ev.type === "error") {
    killThinking(); setStreaming(false);
    addMsg("assistant", `Error: ${ev.message}`, null, "err");
  }
  if (ev.type === "result" && ev.result && !textBuf) {
    ensureBubble(); textBuf = ev.result; renderBubble();
  }
}

// ===== Message rendering =====
function ensureBubble() {
  if (currentEl) return;
  hideEmpty();
  currentEl = addMsgEl("assistant");
  textBuf = "";
}

function renderBubble() {
  if (!currentEl) return;
  const body = currentEl.querySelector(".msg-body");
  const tools = body.querySelectorAll(".tool-ind");
  const toolsHtml = Array.from(tools).map((t) => t.outerHTML).join("");
  let html = marked.parse(textBuf);
  html = html.replace(/<pre><code class="language-(\w+)">/g,
    `<pre><div class="code-head"><span>$1</span><button class="copy-btn" onclick="copyCode(this)">copy</button></div><code class="language-$1">`);
  html = html.replace(/<pre><code>(?!<)/g,
    `<pre><div class="code-head"><span>code</span><button class="copy-btn" onclick="copyCode(this)">copy</button></div><code>`);
  body.innerHTML = html + toolsHtml;
}

function addMsg(role, text, msgImages, cls) {
  hideEmpty();
  const el = addMsgEl(role, msgImages, cls);
  el.querySelector(".msg-body").innerHTML = role === "user"
    ? esc(text).replace(/\n/g, "<br>") : marked.parse(text);
  scroll();
  return el;
}

function addMsgEl(role, msgImages, cls) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const el = document.createElement("div");
  el.className = `msg ${role}${cls ? " " + cls : ""}`;
  let imgsHtml = "";
  if (msgImages?.length) {
    imgsHtml = `<div class="msg-images">${msgImages.map((u) => `<img src="${u}">`).join("")}</div>`;
  }
  el.innerHTML = `
    <div class="msg-header">
      <span class="msg-name">${role === "user" ? "You" : "Claude"}</span>
      <span class="msg-time">${time}</span>
    </div>
    <div class="msg-body">${imgsHtml}</div>
  `;
  messages.appendChild(el);
  return el;
}

// ===== Send =====
function sendMessage() {
  const text = input.value.trim();
  if (!text && !images.length) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  hideEmpty();
  addMsg("user", text || "(image)", images.length ? images.map((i) => i.url) : null);

  ws.send(JSON.stringify({
    type: "message",
    content: text || "Describe this image.",
    images: images.map((i) => ({ data: i.data, mime: i.mime })),
    workingDir: cwdInput.value.trim() || undefined,
    sessionId: sessionId || undefined,
  }));

  input.value = "";
  input.style.height = "auto";
  clearImages();
  currentEl = null;
  textBuf = "";
  updateSend();
}

function abortMessage() {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "abort" }));
}

// ===== Images =====
document.addEventListener("paste", (e) => {
  if (view !== "chat") return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) addImage(file);
    }
  }
});

function handleFileSelect(el) {
  for (const f of el.files) { if (f.type.startsWith("image/")) addImage(f); }
  el.value = "";
}

function addImage(file) {
  const reader = new FileReader();
  reader.onload = () => {
    images.push({ data: reader.result.split(",")[1], mime: file.type, url: URL.createObjectURL(file) });
    renderStrip(); updateSend();
  };
  reader.readAsDataURL(file);
}

function renderStrip() {
  strip.innerHTML = images.map((img, i) => `
    <div class="img-thumb"><img src="${img.url}">
      <button class="img-remove" onclick="removeImage(${i})">&times;</button>
    </div>
  `).join("");
}

function removeImage(i) { URL.revokeObjectURL(images[i].url); images.splice(i, 1); renderStrip(); updateSend(); }
function clearImages() { images.forEach((i) => URL.revokeObjectURL(i.url)); images = []; renderStrip(); }

// ===== Sessions =====
async function loadSessions() {
  try {
    const res = await fetch("/api/sessions");
    sessions = await res.json();
  } catch { sessions = []; }
  renderSessions();
}

function renderSessions() {
  if (!sessions.length) {
    sessionList.innerHTML = `
      <div class="no-sessions">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <p>No active sessions</p>
        <span>Sessions from the last 2 hours will appear here</span>
      </div>
    `;
    return;
  }

  sessionList.innerHTML = sessions.map((s) => {
    const isActive = s.id === sessionId;
    const ago = timeAgo(s.lastActivity);
    const roleLabel = s.lastMessageRole === "user" ? "You" : "Claude";
    const preview = truncate(stripMarkdown(s.lastMessage), 100);

    return `
      <div class="session-card${isActive ? " active" : ""}" onclick="openSession('${escAttr(s.id)}', '${escAttr(s.cwd)}')">
        <div class="card-top">
          <span class="card-project">${esc(s.project)}</span>
          <span class="card-time">${ago}</span>
        </div>
        <div class="card-preview">
          <span class="card-role">${roleLabel}</span>
          <span class="card-text">${esc(preview)}</span>
        </div>
        <div class="card-bottom">
          <span class="card-count">${s.messageCount} msg</span>
          <span class="card-id">${s.id.slice(0, 8)}</span>
        </div>
      </div>
    `;
  }).join("");
}

function openSession(id, cwd) {
  sessionId = id;
  if (cwd) cwdInput.value = cwd;
  topSession.textContent = sessions.find(s => s.id === id)?.project || id.slice(0, 8);
  switchView("chat");
  clearChat();
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "setSession", sessionId: id }));
  }
  input.focus();
  renderSessions();
}

function showSessions() {
  switchView("sessions");
  loadSessions();
}

function newConversation() {
  sessionId = null;
  topSession.textContent = "New";
  switchView("chat");
  clearChat();
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "setSession", sessionId: null }));
  }
  input.focus();
}

function switchView(v) {
  view = v;
  sessionPanel.classList.toggle("hidden", v !== "sessions");
  chatPanel.classList.toggle("hidden", v !== "chat");
}

// ===== Helpers =====
function timeAgo(ts) {
  const d = Date.now() - new Date(ts).getTime();
  if (d < 60000) return "now";
  if (d < 3600000) return Math.floor(d / 60000) + "m";
  if (d < 86400000) return Math.floor(d / 3600000) + "h";
  return Math.floor(d / 86400000) + "d";
}

function truncate(s, max) {
  if (!s || s.length <= max) return s || "";
  return s.slice(0, max).trim() + "...";
}

function stripMarkdown(s) {
  if (!s) return "";
  return s.replace(/[#*_`~\[\]()>]/g, "").replace(/\n+/g, " ").trim();
}

function setStreaming(on) {
  streaming = on;
  sendBtn.classList.toggle("hidden", on);
  stopBtn.classList.toggle("hidden", !on);
  statusDot.classList.toggle("busy", on);
  input.disabled = on;
  if (!on) input.focus();
}

function updateSend() { sendBtn.disabled = !input.value.trim() && !images.length; }
function killThinking() { document.getElementById("thinking")?.remove(); }
function hideEmpty() { document.getElementById("empty-state")?.remove(); }

function clearChat() {
  messages.innerHTML = `
    <div class="empty-state" id="empty-state">
      <p>Send a message to continue this session</p>
    </div>
  `;
  currentEl = null;
  textBuf = "";
}

function scroll() { requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; }); }

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function escAttr(s) { return s.replace(/'/g, "\\'").replace(/"/g, "&quot;"); }

function copyCode(btn) {
  const code = btn.closest("pre").querySelector("code");
  navigator.clipboard.writeText(code.textContent).then(() => {
    btn.textContent = "copied!";
    setTimeout(() => (btn.textContent = "copy"), 1500);
  });
}

// ===== Input =====
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 180) + "px";
  updateSend();
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !streaming) { e.preventDefault(); sendMessage(); }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && streaming) abortMessage();
  if (e.key === "Escape" && view === "chat" && !streaming) showSessions();
});
