// ===== State =====
let ws = null;
let pendingImages = []; // { data: base64, mime: string, url: objectURL }
let isStreaming = false;
let currentAssistantEl = null;
let currentTextAccumulator = "";
let currentSessionId = null;
let workingDir = "";

// ===== DOM =====
const chat = document.getElementById("chat");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send-btn");
const abortBtn = document.getElementById("abort-btn");
const imageStrip = document.getElementById("image-strip");
const sessionOverlay = document.getElementById("session-overlay");
const sessionList = document.getElementById("session-list");
const sessionLabel = document.getElementById("session-label");
const statusDot = document.getElementById("status-dot");
const cwdLabel = document.getElementById("cwd-label");
const welcome = document.getElementById("welcome");

// ===== Markdown setup =====
marked.setOptions({
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true,
});

// ===== WebSocket =====
function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onopen = () => {
    statusDot.classList.add("active");
    statusDot.classList.remove("busy");
  };

  ws.onclose = () => {
    statusDot.classList.remove("active", "busy");
    setTimeout(connect, 2000);
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleEvent(data);
  };
}

// ===== Event handler =====
function handleEvent(event) {
  // Connected
  if (event.type === "connected") return;

  // Thinking indicator
  if (event.type === "thinking") {
    setStreaming(true);
    removeThinking();
    chat.insertAdjacentHTML("beforeend", `
      <div class="thinking" id="thinking">
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        <span>Thinking...</span>
      </div>
    `);
    scrollToBottom();
    return;
  }

  // Stream events from Claude CLI
  if (event.type === "stream_event") {
    const ev = event.event;

    // Message start — create assistant bubble
    if (ev?.type === "message_start") {
      removeThinking();
      ensureAssistantBubble();
    }

    // Text content streaming
    if (ev?.type === "content_block_delta" && ev?.delta?.type === "text_delta") {
      removeThinking();
      ensureAssistantBubble();
      currentTextAccumulator += ev.delta.text;
      renderAssistantContent();
      scrollToBottom();
    }

    // Tool use start
    if (ev?.type === "content_block_start" && ev?.content_block?.type === "tool_use") {
      removeThinking();
      ensureAssistantBubble();
      const toolName = ev.content_block.name || "Tool";
      const toolId = ev.content_block.id || "";
      const indicator = document.createElement("div");
      indicator.className = "tool-indicator";
      indicator.setAttribute("data-tool-id", toolId);
      indicator.innerHTML = `<div class="spinner"></div><span>${escapeHtml(toolName)}</span>`;
      currentAssistantEl.querySelector(".message-body").appendChild(indicator);
      scrollToBottom();
    }

    // Tool use end
    if (ev?.type === "content_block_stop") {
      // Mark tool indicators as done
      if (currentAssistantEl) {
        const indicators = currentAssistantEl.querySelectorAll(".tool-indicator:not(.done)");
        if (indicators.length) {
          indicators[indicators.length - 1].classList.add("done");
        }
      }
    }
  }

  // Session ID capture
  if (event.session_id) {
    currentSessionId = event.session_id;
    sessionLabel.textContent = currentSessionId.slice(0, 8) + "...";
  }

  // Done
  if (event.type === "done") {
    removeThinking();
    setStreaming(false);
    if (event.session_id) {
      currentSessionId = event.session_id;
      sessionLabel.textContent = currentSessionId.slice(0, 8) + "...";
    }
  }

  // Error
  if (event.type === "error") {
    removeThinking();
    setStreaming(false);
    appendError(event.message);
  }

  // Result message (final)
  if (event.type === "result") {
    removeThinking();
    if (event.result && !currentTextAccumulator) {
      ensureAssistantBubble();
      currentTextAccumulator = event.result;
      renderAssistantContent();
    }
    if (event.session_id) {
      currentSessionId = event.session_id;
      sessionLabel.textContent = currentSessionId.slice(0, 8) + "...";
    }
  }
}

function ensureAssistantBubble() {
  if (currentAssistantEl) return;
  welcome?.remove();

  const el = document.createElement("div");
  el.className = "message assistant";
  el.innerHTML = `
    <div class="message-role assistant">Claude</div>
    <div class="message-body"></div>
  `;
  chat.appendChild(el);
  currentAssistantEl = el;
  currentTextAccumulator = "";
}

function renderAssistantContent() {
  if (!currentAssistantEl) return;
  const body = currentAssistantEl.querySelector(".message-body");

  // Preserve tool indicators
  const tools = body.querySelectorAll(".tool-indicator");
  const toolsHtml = Array.from(tools).map((t) => t.outerHTML).join("");

  // Render markdown
  let html = marked.parse(currentTextAccumulator);

  // Add copy buttons to code blocks
  html = html.replace(
    /<pre><code class="language-(\w+)">/g,
    `<pre><div class="code-header"><span>$1</span><button class="copy-btn" onclick="copyCode(this)">copy</button></div><code class="language-$1">`
  );
  // Handle code blocks without language
  html = html.replace(
    /<pre><code>(?!<)/g,
    `<pre><div class="code-header"><span>code</span><button class="copy-btn" onclick="copyCode(this)">copy</button></div><code>`
  );

  body.innerHTML = html + toolsHtml;
}

// ===== Send message =====
function sendMessage() {
  const text = input.value.trim();
  if (!text && !pendingImages.length) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  // Show user message
  welcome?.remove();
  const imagesHtml = pendingImages
    .map((img) => `<img src="${img.url}" alt="attached image">`)
    .join("");

  const msgEl = document.createElement("div");
  msgEl.className = "message user";
  msgEl.innerHTML = `
    <div class="message-role user">You</div>
    <div class="message-body">
      ${imagesHtml ? `<div class="message-images">${imagesHtml}</div>` : ""}
      ${escapeHtml(text).replace(/\n/g, "<br>")}
    </div>
  `;
  chat.appendChild(msgEl);
  scrollToBottom();

  // Send to server
  const payload = {
    type: "message",
    content: text || "Describe this image.",
    images: pendingImages.map((img) => ({ data: img.data, mime: img.mime })),
    workingDir: workingDir || undefined,
    sessionId: currentSessionId || undefined,
  };
  ws.send(JSON.stringify(payload));

  // Reset
  input.value = "";
  input.style.height = "auto";
  clearImages();
  currentAssistantEl = null;
  currentTextAccumulator = "";
  updateSendBtn();
}

function abortMessage() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "abort" }));
  }
}

// ===== Image paste =====
document.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) addImageFile(file);
    }
  }
});

// Drag and drop
const inputArea = document.querySelector(".input-area");
inputArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  inputArea.style.borderColor = "var(--accent)";
});
inputArea.addEventListener("dragleave", () => {
  inputArea.style.borderColor = "";
});
inputArea.addEventListener("drop", (e) => {
  e.preventDefault();
  inputArea.style.borderColor = "";
  for (const file of e.dataTransfer.files) {
    if (file.type.startsWith("image/")) {
      addImageFile(file);
    }
  }
});

function addImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(",")[1];
    const url = URL.createObjectURL(file);
    const img = { data: base64, mime: file.type, url };
    pendingImages.push(img);
    renderImageStrip();
    updateSendBtn();
  };
  reader.readAsDataURL(file);
}

function renderImageStrip() {
  imageStrip.innerHTML = "";
  if (!pendingImages.length) {
    imageStrip.classList.add("hidden");
    return;
  }
  imageStrip.classList.remove("hidden");
  pendingImages.forEach((img, i) => {
    const el = document.createElement("div");
    el.className = "image-preview";
    el.innerHTML = `
      <img src="${img.url}" alt="preview">
      <button class="remove-img" onclick="removeImage(${i})">&times;</button>
    `;
    imageStrip.appendChild(el);
  });
}

function removeImage(index) {
  URL.revokeObjectURL(pendingImages[index].url);
  pendingImages.splice(index, 1);
  renderImageStrip();
  updateSendBtn();
}

function clearImages() {
  pendingImages.forEach((img) => URL.revokeObjectURL(img.url));
  pendingImages = [];
  renderImageStrip();
}

// ===== Session management =====
async function openSessionPicker() {
  sessionOverlay.classList.remove("hidden");
  sessionList.innerHTML = `<div class="session-loading">Loading sessions...</div>`;

  try {
    const res = await fetch("/api/sessions");
    const sessions = await res.json();

    if (!sessions.length) {
      sessionList.innerHTML = `<div class="session-loading">No sessions found</div>`;
      return;
    }

    sessionList.innerHTML = sessions
      .map(
        (s) => `
      <div class="session-item ${s.id === currentSessionId ? "active" : ""}"
           onclick="pickSession('${s.id}')">
        <span class="session-id">${s.id}</span>
        <span class="session-date">${s.label || ""}</span>
      </div>
    `
      )
      .join("");
  } catch {
    sessionList.innerHTML = `<div class="session-loading">Could not load sessions</div>`;
  }
}

function closeSessionPicker() {
  sessionOverlay.classList.add("hidden");
}

function pickSession(id) {
  currentSessionId = id;
  sessionLabel.textContent = id.slice(0, 8) + "...";
  closeSessionPicker();
}

function newSession() {
  currentSessionId = null;
  sessionLabel.textContent = "New session";
  // Clear chat
  chat.innerHTML = "";
  currentAssistantEl = null;
  currentTextAccumulator = "";
  closeSessionPicker();
}

function resumeLatest() {
  // Send a continue flag — server will use --continue
  currentSessionId = "__latest__";
  sessionLabel.textContent = "Latest...";
  closeSessionPicker();
}

// ===== Working directory =====
function changeCwd() {
  const dir = prompt("Working directory:", workingDir);
  if (dir !== null) {
    workingDir = dir.trim();
    cwdLabel.textContent = workingDir
      ? workingDir.replace(/^.*[/\\]/, "~/.../")
      : "";
  }
}

// ===== Helpers =====
function setStreaming(state) {
  isStreaming = state;
  sendBtn.classList.toggle("hidden", state);
  abortBtn.classList.toggle("hidden", !state);
  statusDot.classList.toggle("busy", state);
  input.disabled = state;
  if (!state) input.focus();
}

function updateSendBtn() {
  sendBtn.disabled = !input.value.trim() && !pendingImages.length;
}

function removeThinking() {
  document.getElementById("thinking")?.remove();
}

function appendError(msg) {
  const el = document.createElement("div");
  el.className = "message assistant";
  el.innerHTML = `
    <div class="message-role assistant">Error</div>
    <div class="message-body" style="border-color: var(--error); color: var(--error);">
      ${escapeHtml(msg)}
    </div>
  `;
  chat.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chat.scrollTop = chat.scrollHeight;
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function copyCode(btn) {
  const code = btn.closest("pre").querySelector("code");
  navigator.clipboard.writeText(code.textContent).then(() => {
    btn.textContent = "copied!";
    setTimeout(() => (btn.textContent = "copy"), 1500);
  });
}

// ===== Input handling =====
input.addEventListener("input", () => {
  // Auto-resize
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
  updateSendBtn();
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!isStreaming) sendMessage();
  }
});

// ===== Init =====
connect();
updateSendBtn();
