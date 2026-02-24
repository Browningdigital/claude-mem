/**
 * Upload UI — device-aware universal content drop zone.
 * Detects mobile vs desktop and adjusts UX accordingly.
 */
export function renderUploadPage(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Drop Zone</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#c9d1d9;--text2:#8b949e;--accent:#58a6ff;--green:#3fb950;--red:#f85149;--radius:12px}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100dvh;display:flex;flex-direction:column;align-items:center;padding:20px;-webkit-tap-highlight-color:transparent}
h1{font-size:1.5rem;font-weight:600;margin-bottom:4px}
.subtitle{color:var(--text2);font-size:.875rem;margin-bottom:24px}

/* Drop Zone */
.drop-zone{width:100%;max-width:560px;border:2px dashed var(--border);border-radius:var(--radius);padding:48px 24px;text-align:center;cursor:pointer;transition:all .2s;position:relative;background:var(--surface)}
.drop-zone.hover,.drop-zone:hover{border-color:var(--accent);background:rgba(88,166,255,.06)}
.drop-zone.processing{border-color:var(--accent);pointer-events:none;opacity:.7}
.drop-zone-icon{font-size:3rem;margin-bottom:12px;line-height:1}
.drop-zone-text{font-size:1rem;color:var(--text);margin-bottom:4px}
.drop-zone-hint{font-size:.8rem;color:var(--text2)}
input[type=file]{display:none}

/* Upload buttons row */
.btn-row{display:flex;gap:10px;margin-top:16px;width:100%;max-width:560px;flex-wrap:wrap}
.btn{flex:1;min-width:120px;padding:14px 16px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);font-size:.9rem;font-weight:500;cursor:pointer;text-align:center;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:8px}
.btn:hover{border-color:var(--accent);background:rgba(88,166,255,.08)}
.btn:active{transform:scale(.97)}
.btn-primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.btn-primary:hover{background:#4c9aed}

/* URL input */
.url-section{width:100%;max-width:560px;margin-top:16px}
.url-row{display:flex;gap:8px}
.url-input{flex:1;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);font-size:.9rem;outline:none}
.url-input:focus{border-color:var(--accent)}
.url-input::placeholder{color:var(--text2)}

/* Progress */
.progress{display:none;width:100%;max-width:560px;margin-top:16px}
.progress.show{display:block}
.progress-bar{height:4px;background:var(--border);border-radius:2px;overflow:hidden}
.progress-fill{height:100%;background:var(--accent);width:0;transition:width .3s;border-radius:2px}
.progress-text{font-size:.8rem;color:var(--text2);margin-top:6px;text-align:center}

/* Result card */
.result{display:none;width:100%;max-width:560px;margin-top:20px}
.result.show{display:block}
.result-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;position:relative}
.result-card.error{border-color:var(--red)}
.result-title{font-size:1rem;font-weight:600;margin-bottom:8px;word-break:break-word}
.result-meta{font-size:.8rem;color:var(--text2);margin-bottom:12px}
.result-link{display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 14px;cursor:pointer;transition:all .15s}
.result-link:hover{border-color:var(--accent)}
.result-link-url{flex:1;font-family:monospace;font-size:.85rem;color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.result-link-copy{padding:6px 14px;background:var(--accent);color:#fff;border:none;border-radius:6px;font-size:.8rem;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .15s}
.result-link-copy:hover{background:#4c9aed}
.result-link-copy.copied{background:var(--green)}
.result-memory{font-size:.8rem;color:var(--green);margin-top:10px}
.result-error{color:var(--red);font-size:.9rem}

/* History */
.history{width:100%;max-width:560px;margin-top:28px}
.history h2{font-size:1rem;font-weight:600;color:var(--text2);margin-bottom:10px}
.history-item{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;transition:all .15s}
.history-item:hover{border-color:var(--accent)}
.history-icon{font-size:1.2rem;flex-shrink:0}
.history-text{flex:1;overflow:hidden}
.history-title{font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.history-time{font-size:.75rem;color:var(--text2)}

/* Device-specific */
.desktop-only{display:none}
.mobile-only{display:none}
@media(hover:hover)and(pointer:fine){.desktop-only{display:flex}}
@media(hover:none),(pointer:coarse){.mobile-only{display:flex}}
</style>
</head>
<body>

<h1>Drop Zone</h1>
<p class="subtitle">Upload any file or paste a URL. One-click copy link for Claude.</p>

<div class="drop-zone" id="dropZone">
  <div class="drop-zone-icon" id="dzIcon">+</div>
  <div class="drop-zone-text" id="dzText">Drop files here or tap to upload</div>
  <div class="drop-zone-hint" id="dzHint">PDF, images, audio, video, code, documents — any format</div>
</div>
<input type="file" id="fileInput" multiple>

<div class="btn-row">
  <button class="btn" id="btnFile" onclick="document.getElementById('fileInput').click()">
    <span>Choose File</span>
  </button>
  <button class="btn mobile-only" id="btnCamera" onclick="openCamera()">
    <span>Camera</span>
  </button>
  <button class="btn desktop-only" id="btnPaste" onclick="pasteFromClipboard()">
    <span>Paste</span>
  </button>
</div>

<div class="url-section">
  <div class="url-row">
    <input class="url-input" id="urlInput" placeholder="Or paste a URL here..." autocomplete="off" autocapitalize="off">
    <button class="btn btn-primary" onclick="extractUrl()" style="min-width:auto;flex:0">Go</button>
  </div>
</div>

<div class="progress" id="progress">
  <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
  <div class="progress-text" id="progressText">Processing...</div>
</div>

<div class="result" id="result"></div>

<div class="history" id="history"></div>

<script>
const BASE = ${JSON.stringify(baseUrl)};
const dz = document.getElementById('dropZone');
const fi = document.getElementById('fileInput');
const prog = document.getElementById('progress');
const progFill = document.getElementById('progressFill');
const progText = document.getElementById('progressText');
const resultDiv = document.getElementById('result');
const historyDiv = document.getElementById('history');

// Device detection
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

// Adjust file input for device
if (isIOS) {
  fi.setAttribute('accept', '*/*');
  document.getElementById('dzText').textContent = 'Tap to upload any file';
  document.getElementById('dzHint').textContent = 'Photos, screenshots, PDFs, audio — whatever you have';
}

// Drag & drop (desktop)
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('hover'); });
dz.addEventListener('dragleave', () => dz.classList.remove('hover'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('hover'); handleFiles(e.dataTransfer.files); });
dz.addEventListener('click', () => fi.click());
fi.addEventListener('change', () => { if (fi.files.length) handleFiles(fi.files); });

// URL enter key
document.getElementById('urlInput').addEventListener('keydown', e => { if (e.key === 'Enter') extractUrl(); });

// Paste handler (desktop)
document.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.kind === 'file') {
      e.preventDefault();
      const f = item.getAsFile();
      if (f) handleFiles([f]);
      return;
    }
  }
});

function openCamera() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.capture = 'environment';
  inp.onchange = () => { if (inp.files.length) handleFiles(inp.files); };
  inp.click();
}

async function pasteFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          const file = new File([blob], 'clipboard.' + type.split('/')[1], { type });
          handleFiles([file]);
          return;
        }
      }
    }
    // No image, try text (might be a URL)
    const text = await navigator.clipboard.readText();
    if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
      document.getElementById('urlInput').value = text;
      extractUrl();
    }
  } catch { /* clipboard not available */ }
}

function showProgress(text, pct) {
  prog.classList.add('show');
  progText.textContent = text;
  progFill.style.width = pct + '%';
}

function hideProgress() { prog.classList.remove('show'); }

async function handleFiles(files) {
  for (const file of files) {
    await uploadFile(file);
  }
}

async function uploadFile(file) {
  showProgress('Uploading ' + file.name + '...', 20);
  dz.classList.add('processing');

  const fd = new FormData();
  fd.append('file', file);

  try {
    showProgress('Processing ' + file.name + '...', 50);
    const res = await fetch(BASE + '/api/upload', { method: 'POST', body: fd });
    showProgress('Analyzing...', 80);
    const data = await res.json();

    if (data.error) {
      showResult({ error: data.error, title: file.name });
    } else {
      showResult(data);
      saveHistory(data);
    }
    showProgress('Done!', 100);
    setTimeout(hideProgress, 1000);
  } catch (e) {
    showResult({ error: e.message, title: file.name });
    hideProgress();
  }
  dz.classList.remove('processing');
}

async function extractUrl() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) return;
  if (!url.startsWith('http')) {
    document.getElementById('urlInput').value = 'https://' + url;
  }

  showProgress('Extracting content...', 30);

  try {
    // Use the MCP extract_and_remember tool
    const res = await fetch(BASE + '/api/extract?url=' + encodeURIComponent(url));
    showProgress('Analyzing...', 70);
    const data = await res.json();

    if (data.error && !data.content) {
      showResult({ error: data.error, title: url });
    } else {
      // Store as upload for the short link
      const storeRes = await fetch(BASE + '/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, title: data.title, content: data.content, content_type: data.content_type, metadata: data.metadata }),
      });
      const storeData = await storeRes.json();
      showResult(storeData);
      if (!storeData.error) saveHistory(storeData);
    }
    showProgress('Done!', 100);
    setTimeout(hideProgress, 1000);
  } catch (e) {
    showResult({ error: e.message, title: url });
    hideProgress();
  }
}

function showResult(data) {
  resultDiv.classList.add('show');
  if (data.error) {
    resultDiv.innerHTML = '<div class="result-card error"><div class="result-title">' + esc(data.title || 'Error') + '</div><div class="result-error">' + esc(data.error) + '</div></div>';
    return;
  }
  const link = data.link || (BASE + '/c/' + data.id);
  resultDiv.innerHTML =
    '<div class="result-card">' +
      '<div class="result-title">' + esc(data.title) + '</div>' +
      '<div class="result-meta">' + esc(data.content_type) + ' &middot; ' + formatSize(data.content_length) + ' chars</div>' +
      '<div class="result-link" onclick="copyLink(this, \\'' + esc(link) + '\\')">' +
        '<span class="result-link-url">' + esc(link) + '</span>' +
        '<button class="result-link-copy">Copy</button>' +
      '</div>' +
      (data.memory_saved ? '<div class="result-memory">Saved to Browning Memory</div>' : '') +
    '</div>';
}

function copyLink(el, link) {
  navigator.clipboard.writeText(link).then(() => {
    const btn = el.querySelector('.result-link-copy');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}

function saveHistory(data) {
  const list = JSON.parse(localStorage.getItem('ce_history') || '[]');
  list.unshift({ id: data.id, title: data.title, type: data.content_type, time: Date.now(), link: data.link });
  if (list.length > 20) list.pop();
  localStorage.setItem('ce_history', JSON.stringify(list));
  renderHistory();
}

function renderHistory() {
  const list = JSON.parse(localStorage.getItem('ce_history') || '[]');
  if (!list.length) { historyDiv.innerHTML = ''; return; }
  const icons = { pdf:'doc', image:'img', audio:'audio', video:'video', text:'txt', code:'</>',
    webpage:'web', youtube:'yt', twitter:'tw', threads:'th', instagram:'ig', linkedin:'in', tiktok:'tk' };
  let html = '<h2>Recent</h2>';
  for (const item of list.slice(0, 8)) {
    const ago = timeAgo(item.time);
    html += '<div class="history-item" onclick="copyLink(this, \\'' + esc(item.link || BASE + '/c/' + item.id) + '\\')">' +
      '<span class="history-icon">' + (icons[item.type] || 'file') + '</span>' +
      '<div class="history-text"><div class="history-title">' + esc(item.title) + '</div>' +
      '<div class="history-time">' + ago + '</div></div>' +
      '<button class="result-link-copy" style="font-size:.75rem;padding:4px 10px">Copy</button></div>';
  }
  historyDiv.innerHTML = html;
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}
function formatSize(n) { return n > 1000 ? (n/1000).toFixed(1) + 'k' : n; }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

renderHistory();
</script>
</body>
</html>`;
}
