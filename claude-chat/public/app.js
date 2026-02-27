// ===== State =====
let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let images = []; // { data, mime, url }
let streaming = false;
let currentEl = null;
let textBuf = "";
let sessionId = null;
let conversations = JSON.parse(localStorage.getItem("cc_convos") || "[]");
let connected = false;
let serverCwd = "";
let remoteSessions = []; // cached from /api/sessions

// ===== DOM refs =====
const $ = (s) => document.querySelector(s);
const messages = $("#messages");
const input = $("#input");
const sendBtn = $("#send-btn");
const stopBtn = $("#stop-btn");
const strip = $("#image-strip");
const sidebar = $("#sidebar");
const sessionList = $("#session-list");
const statusDot = $("#status-dot");
const statusText = $("#status-text");
const cwdInput = $("#cwd-input");
const topSession = $("#topbar-session");
const emptyState = $("#empty-state");

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
loadSessions(); // always load remote sessions on startup
renderConversationList();
updateSend();
checkHealth();

// ===== Health check — verify claude CLI is available =====
async function checkHealth() {
  try {
    const res = await fetch("/api/ping");
    const data = await res.json();
    if (!data.claude) {
      const banner = document.createElement("div");
      banner.className = "msg err";
      banner.style.cssText = "margin:16px;padding:16px;border:1px solid #e53e3e;border-radius:8px;background:#2d1b1b";
      banner.innerHTML = `
        <h3 style="margin:0 0 8px;color:#fc8181">Claude Code CLI Not Found</h3>
        <p style="margin:0 0 8px;color:#feb2b2">${data.claudeError || "The claude command is not available on this machine."}</p>
        <p style="margin:0;color:#a0aec0;font-size:13px">This app requires Claude Code CLI to work. Install it with:<br>
        <code style="background:#1a1a2e;padding:4px 8px;border-radius:4px;margin-top:4px;display:inline-block">npm install -g @anthropic-ai/claude-code</code></p>
      `;
      messages.prepend(banner);
      input.placeholder = "Claude CLI not installed — see error above";
      input.disabled = true;
    }
  } catch {}
}

// ===== WebSocket with aggressive auto-reconnect =====
function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  statusText.textContent = "Connecting...";
  statusDot.classList.remove("connected", "busy");

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  try {
    ws = new WebSocket(`${proto}//${location.host}/ws`);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    connected = true;
    reconnectDelay = 1000;
    statusDot.classList.add("connected");
    statusDot.classList.remove("busy");
    statusText.textContent = "Connected";
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (sessionId) {
      ws.send(JSON.stringify({ type: "setSession", sessionId }));
    }
  };

  ws.onclose = () => {
    connected = false;
    statusDot.classList.remove("connected", "busy");
    statusText.textContent = "Disconnected \u2014 click to reconnect";
    scheduleReconnect();
  };

  ws.onerror = () => {};

  ws.onmessage = (e) => {
    try { handleEvent(JSON.parse(e.data)); } catch {}
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

function forceReconnect() {
  if (connected) return;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectDelay = 1000;
  if (ws) { try { ws.close(); } catch {} ws = null; }
  statusText.textContent = "Reconnecting...";
  connect();
}

// Keep-alive: check every 30s
setInterval(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (!reconnectTimer) connect();
  }
}, 30000);

// Reconnect on tab focus
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && (!ws || ws.readyState !== WebSocket.OPEN)) {
    forceReconnect();
  }
});

window.addEventListener("focus", () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) forceReconnect();
});

// ===== Event handler =====
function handleEvent(ev) {
  // Server sends cwd/platform on connect
  if (ev.type === "connected") {
    if (ev.cwd && !cwdInput.value) {
      serverCwd = ev.cwd;
      cwdInput.value = ev.cwd;
    }
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

    if (e?.type === "message_start") {
      killThinking();
      ensureBubble();
    }

    if (e?.type === "content_block_delta" && e?.delta?.type === "text_delta") {
      killThinking();
      ensureBubble();
      textBuf += e.delta.text;
      renderBubble();
      scroll();
    }

    if (e?.type === "content_block_start" && e?.content_block?.type === "tool_use") {
      killThinking();
      ensureBubble();
      const name = e.content_block.name || "Tool";
      const id = e.content_block.id || "";
      const t = document.createElement("span");
      t.className = "tool-ind";
      t.dataset.toolId = id;
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
    topSession.textContent = sessionId.slice(0, 12) + "...";
    saveConvo();
  }

  if (ev.type === "done") {
    killThinking();
    setStreaming(false);
    saveConvo();
  }

  if (ev.type === "error") {
    killThinking();
    setStreaming(false);
    addMsg("assistant", `Error: ${ev.message}`, null, "err");
  }

  if (ev.type === "result" && ev.result && !textBuf) {
    ensureBubble();
    textBuf = ev.result;
    renderBubble();
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
    ? esc(text).replace(/\n/g, "<br>")
    : marked.parse(text);
  scroll();
  return el;
}

function addMsgEl(role, msgImages, cls) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const avatar = role === "user" ? "Y" : "C";
  const name = role === "user" ? "You" : "Claude";

  const el = document.createElement("div");
  el.className = `msg ${role}${cls ? " " + cls : ""}`;

  let imgsHtml = "";
  if (msgImages?.length) {
    imgsHtml = `<div class="msg-images">${msgImages.map((u) => `<img src="${u}" onclick="lightbox(this.src)">`).join("")}</div>`;
  }

  el.innerHTML = `
    <div class="msg-header">
      <div class="msg-avatar">${avatar}</div>
      <div class="msg-name">${name}</div>
      <div class="msg-time">${time}</div>
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
  const imgUrls = images.map((i) => i.url);
  addMsg("user", text || "(image)", imgUrls.length ? imgUrls : null);

  ws.send(JSON.stringify({
    type: "message",
    content: text || "Describe this image.",
    images: images.map((i) => ({ data: i.data, mime: i.mime })),
    workingDir: cwdInput.value.trim() || undefined,
    sessionId: sessionId || undefined,
  }));

  saveConvo();

  input.value = "";
  input.style.height = "auto";
  clearImages();
  currentEl = null;
  textBuf = "";
  updateSend();
}

function abortMessage() {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "abort" }));
  }
}

// ===== Images =====
document.addEventListener("paste", (e) => {
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

const mainEl = $(".main");
mainEl.addEventListener("dragover", (e) => { e.preventDefault(); e.currentTarget.style.outline = "2px solid var(--accent)"; });
mainEl.addEventListener("dragleave", (e) => { e.currentTarget.style.outline = ""; });
mainEl.addEventListener("drop", (e) => {
  e.preventDefault();
  e.currentTarget.style.outline = "";
  for (const f of e.dataTransfer.files) {
    if (f.type.startsWith("image/")) addImage(f);
  }
});

function handleFileSelect(el) {
  for (const f of el.files) {
    if (f.type.startsWith("image/")) addImage(f);
  }
  el.value = "";
}

function addImage(file) {
  const reader = new FileReader();
  reader.onload = () => {
    images.push({
      data: reader.result.split(",")[1],
      mime: file.type,
      url: URL.createObjectURL(file),
    });
    renderStrip();
    updateSend();
    input.focus();
  };
  reader.readAsDataURL(file);
}

function renderStrip() {
  strip.innerHTML = images.map((img, i) => `
    <div class="img-thumb">
      <img src="${img.url}">
      <button class="img-remove" onclick="removeImage(${i})">&times;</button>
    </div>
  `).join("");
}

function removeImage(i) {
  URL.revokeObjectURL(images[i].url);
  images.splice(i, 1);
  renderStrip();
  updateSend();
}

function clearImages() {
  images.forEach((i) => URL.revokeObjectURL(i.url));
  images = [];
  renderStrip();
}

// ===== Sessions =====
async function loadSessions() {
  try {
    const res = await fetch("/api/sessions");
    remoteSessions = await res.json();
  } catch {
    remoteSessions = [];
  }
  renderConversationList();
}

function resumeSession(id) {
  // When clicking a remote session, also set cwd from that session
  const remote = remoteSessions.find((s) => s.id === id);
  if (remote?.cwd) cwdInput.value = remote.cwd;

  sessionId = id;
  topSession.textContent = id.slice(0, 12) + "...";
  clearChat();
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "setSession", sessionId: id }));
  }
  closeSidebar();
}

function newConversation() {
  sessionId = null;
  topSession.textContent = "New conversation";
  clearChat();
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "setSession", sessionId: null }));
  }
  closeSidebar();
  input.focus();
}

// ===== Conversation persistence =====
function saveConvo() {
  if (!sessionId) return;
  const html = messages.innerHTML;
  const idx = conversations.findIndex((c) => c.id === sessionId);
  const entry = {
    id: sessionId,
    html,
    updated: Date.now(),
    label: sessionId.slice(0, 12),
  };
  if (idx >= 0) conversations[idx] = entry;
  else conversations.unshift(entry);
  conversations = conversations.slice(0, 50);
  try { localStorage.setItem("cc_convos", JSON.stringify(conversations)); } catch {}
  renderConversationList();
}

function renderConversationList() {
  let html = "";

  // Local conversations (from this browser)
  const saved = conversations.slice(0, 20);
  if (saved.length) {
    html += `<div class="sidebar-label" style="padding:8px 12px 4px;font-size:11px;text-transform:uppercase;color:var(--text-3)">Local</div>`;
    html += saved.map((c) => `
      <div class="session-item${c.id === sessionId ? " active" : ""}" onclick="loadConvo('${c.id}')">
        <span class="sid">${c.label || c.id.slice(0, 12)}</span>
        <span class="meta">${timeAgo(c.updated)}</span>
      </div>
    `).join("");
  }

  // Remote sessions (from filesystem scan)
  const localIds = new Set(saved.map((c) => c.id));
  const remoteOnly = remoteSessions.filter((s) => !localIds.has(s.id));
  if (remoteOnly.length) {
    html += `<div class="sidebar-label" style="padding:12px 12px 4px;font-size:11px;text-transform:uppercase;color:var(--text-3);border-top:1px solid var(--border)">Sessions on disk</div>`;
    html += remoteOnly.slice(0, 30).map((s) => `
      <div class="session-item${s.id === sessionId ? " active" : ""}" onclick="resumeSession('${esc(s.id)}')">
        <span class="sid" title="${esc(s.id)}">${esc(s.label || s.id.slice(0, 12))}</span>
        <span class="meta">${esc(shortPath(s.cwd))}</span>
      </div>
    `).join("");
  }

  if (!html) {
    html = `<div style="padding:12px;color:var(--text-3);font-size:13px">No sessions yet. Start chatting!</div>`;
  }

  sessionList.innerHTML = html;
}

function shortPath(p) {
  if (!p) return "";
  const parts = p.split(/[/\\]/);
  return parts.slice(-2).join("/");
}

function loadConvo(id) {
  const c = conversations.find((x) => x.id === id);
  if (!c) return;
  sessionId = id;
  topSession.textContent = id.slice(0, 12) + "...";
  messages.innerHTML = c.html;
  hideEmpty();
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "setSession", sessionId: id }));
  }
  scroll();
  closeSidebar();
}

function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return "now";
  if (d < 3600000) return Math.floor(d / 60000) + "m";
  if (d < 86400000) return Math.floor(d / 3600000) + "h";
  return Math.floor(d / 86400000) + "d";
}

// ===== Lightbox =====
function lightbox(src) {
  const lb = document.createElement("div");
  lb.className = "lightbox";
  lb.innerHTML = `<img src="${src}">`;
  lb.onclick = () => lb.remove();
  document.body.appendChild(lb);
}

// ===== Helpers =====
function setStreaming(on) {
  streaming = on;
  sendBtn.classList.toggle("hidden", on);
  stopBtn.classList.toggle("hidden", !on);
  statusDot.classList.toggle("busy", on);
  input.disabled = on;
  if (!on) input.focus();
}

function updateSend() {
  sendBtn.disabled = !input.value.trim() && !images.length;
}

function killThinking() { document.getElementById("thinking")?.remove(); }

function hideEmpty() { emptyState?.remove(); }

function clearChat() {
  messages.innerHTML = `
    <div class="empty-state" id="empty-state">
      <div class="empty-icon">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </div>
      <h2>What can I help you with?</h2>
      <p>Ctrl+V to paste images &middot; Enter to send &middot; Shift+Enter for newline</p>
    </div>
  `;
  currentEl = null;
  textBuf = "";
}

function scroll() {
  requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function copyCode(btn) {
  const code = btn.closest("pre").querySelector("code");
  navigator.clipboard.writeText(code.textContent).then(() => {
    btn.textContent = "copied!";
    setTimeout(() => (btn.textContent = "copy"), 1500);
  });
}

function toggleSidebar() { sidebar.classList.toggle("open"); }
function closeSidebar() { sidebar.classList.remove("open"); }

// ===== Input =====
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 180) + "px";
  updateSend();
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !streaming) {
    e.preventDefault();
    sendMessage();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && streaming) abortMessage();
  if (e.key === "Escape") document.querySelector(".lightbox")?.remove();
});

document.addEventListener("click", (e) => {
  if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && e.target.id !== "menu-btn") {
    closeSidebar();
  }
});
