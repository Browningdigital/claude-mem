/**
 * Browning Cloud Node — Interactive Chat Relay
 *
 * WebSocket server that wraps Claude Code CLI, giving you a real-time
 * chat interface from your iPhone. Each message streams Claude's response
 * as it happens — tool calls, file edits, bash commands, everything.
 *
 * Architecture:
 *   Browser (Safari) ←→ WSS (Cloudflare Tunnel) ←→ This Server ←→ Claude Code CLI
 *
 * Runs on the VPS behind Cloudflare Tunnel at chat.yourdomain.com
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ── Config ──

const PORT = parseInt(process.env.RELAY_PORT || '3000');
const AUTH_TOKEN = process.env.RELAY_AUTH_TOKEN || '';
const WORKSPACE = process.env.WORKSPACE_DIR || join(process.env.HOME || '/home/agent', 'workspace');
const CLAUDE_MEM = process.env.CLAUDE_MEM_REPO || join(process.env.HOME || '/home/agent', 'claude-mem');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wcdyvukzlxxkgvxomaxr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const SESSIONS_DIR = join(WORKSPACE, '.chat-sessions');
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '3');

mkdirSync(SESSIONS_DIR, { recursive: true });
mkdirSync(WORKSPACE, { recursive: true });

// Track active Claude processes
const activeSessions = new Map();
let activeProcessCount = 0;

// ── HTTP Server (serves chat UI + handles auth) ──

const httpServer = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      active_sessions: activeSessions.size,
      active_processes: activeProcessCount,
    }));
    return;
  }

  // Login page
  if (url.pathname === '/login' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderLoginPage());
    return;
  }

  // Login POST
  if (url.pathname === '/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const token = params.get('token');
      if (token === AUTH_TOKEN) {
        res.writeHead(302, {
          'Location': '/',
          'Set-Cookie': `relay_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`,
        });
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(renderLoginPage('Invalid token'));
      }
    });
    return;
  }

  // Auth check for all other routes
  const cookies = (req.headers.cookie || '').split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    if (k && v) acc[k] = v;
    return acc;
  }, {});

  if (AUTH_TOKEN && cookies['relay_token'] !== AUTH_TOKEN) {
    res.writeHead(302, { 'Location': '/login' });
    res.end();
    return;
  }

  // Sessions list API
  if (url.pathname === '/api/sessions') {
    const sessions = getStoredSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sessions));
    return;
  }

  // Main chat UI
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderChatUI());
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ── WebSocket Server ──

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  // Auth check via cookie
  const cookies = (req.headers.cookie || '').split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    if (k && v) acc[k] = v;
    return acc;
  }, {});

  if (AUTH_TOKEN && cookies['relay_token'] !== AUTH_TOKEN) {
    ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
    ws.close();
    return;
  }

  let sessionId = null;
  let claudeProcess = null;
  let conversationDir = null;

  const send = (data) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(data));
  };

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send({ type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      // Start or resume a session
      case 'session.start': {
        sessionId = msg.session_id || randomUUID();
        conversationDir = join(SESSIONS_DIR, sessionId);
        mkdirSync(conversationDir, { recursive: true });

        // Copy CLAUDE.md for context
        const claudeMd = join(CLAUDE_MEM, 'CLAUDE.md');
        if (existsSync(claudeMd)) {
          try {
            writeFileSync(join(conversationDir, 'CLAUDE.md'), readFileSync(claudeMd));
          } catch { /* non-fatal */ }
        }
        const claudeDir = join(CLAUDE_MEM, '.claude');
        if (existsSync(claudeDir)) {
          mkdirSync(join(conversationDir, '.claude'), { recursive: true });
          try {
            const files = readdirSync(claudeDir);
            for (const f of files) {
              const src = join(claudeDir, f);
              const dst = join(conversationDir, '.claude', f);
              writeFileSync(dst, readFileSync(src));
            }
          } catch { /* non-fatal */ }
        }

        // Save session metadata
        const meta = {
          id: sessionId,
          created_at: new Date().toISOString(),
          working_dir: msg.working_dir || conversationDir,
          repo: msg.repo || null,
          title: msg.title || 'New Session',
          messages: [],
        };
        writeFileSync(join(conversationDir, 'meta.json'), JSON.stringify(meta, null, 2));

        // Clone repo if specified
        if (msg.repo) {
          send({ type: 'system', message: `Cloning ${msg.repo}...` });
          const repoDir = join(conversationDir, 'repo');
          try {
            const clone = spawn('git', ['clone', msg.repo, repoDir]);
            await new Promise((resolve, reject) => {
              clone.on('close', (code) => code === 0 ? resolve() : reject(new Error(`git clone failed: ${code}`)));
              clone.on('error', reject);
            });
            if (msg.branch) {
              spawn('git', ['checkout', msg.branch], { cwd: repoDir });
            }
            meta.working_dir = repoDir;
            writeFileSync(join(conversationDir, 'meta.json'), JSON.stringify(meta, null, 2));
            send({ type: 'system', message: `Cloned to ${repoDir}` });
          } catch (e) {
            send({ type: 'system', message: `Clone failed: ${e.message}` });
          }
        }

        send({ type: 'session.started', session_id: sessionId, working_dir: meta.working_dir });

        // Log to Supabase
        logToSupabase('session_start', sessionId, meta.title);
        break;
      }

      // Send a message to Claude
      case 'message': {
        if (!sessionId) {
          send({ type: 'error', message: 'Start a session first' });
          return;
        }

        if (activeProcessCount >= MAX_CONCURRENT) {
          send({ type: 'error', message: `Max ${MAX_CONCURRENT} concurrent tasks. Wait for one to finish.` });
          return;
        }

        // Kill previous process if still running
        if (claudeProcess && !claudeProcess.killed) {
          claudeProcess.kill('SIGTERM');
          activeProcessCount = Math.max(0, activeProcessCount - 1);
        }

        const prompt = msg.content;
        if (!prompt) {
          send({ type: 'error', message: 'Empty message' });
          return;
        }

        // Save user message
        appendMessage(conversationDir, 'user', prompt);
        send({ type: 'message.ack', role: 'user', content: prompt });

        // Read session meta for working dir
        let meta;
        try {
          meta = JSON.parse(readFileSync(join(conversationDir, 'meta.json'), 'utf8'));
        } catch {
          meta = { working_dir: conversationDir };
        }

        // Build Claude command
        const args = ['-p', '--output-format', 'stream-json'];

        // Check if this session has previous messages (use --continue)
        const msgFile = join(conversationDir, 'messages.jsonl');
        const messageCount = existsSync(msgFile)
          ? readFileSync(msgFile, 'utf8').trim().split('\n').length
          : 0;
        if (messageCount > 1) {
          args.push('--continue');
        }

        send({ type: 'assistant.thinking', message: 'Claude is working...' });

        const claudePath = join(process.env.HOME || '/home/agent', '.local', 'bin', 'claude');
        const claudeBin = existsSync(claudePath) ? claudePath : 'claude';

        claudeProcess = spawn(claudeBin, args, {
          cwd: meta.working_dir || conversationDir,
          env: {
            ...process.env,
            PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        activeSessions.set(sessionId, claudeProcess);
        activeProcessCount++;

        // Send prompt to stdin
        claudeProcess.stdin.write(prompt);
        claudeProcess.stdin.end();

        let fullOutput = '';
        let currentAssistantMessage = '';

        // Stream stdout (stream-json format: one JSON object per line)
        claudeProcess.stdout.on('data', (chunk) => {
          const text = chunk.toString();
          fullOutput += text;

          // Parse each line as JSON
          const lines = text.split('\n').filter(l => l.trim());
          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              handleStreamEvent(event, send);

              // Accumulate assistant text
              if (event.type === 'content_block_delta' && event.delta?.text) {
                currentAssistantMessage += event.delta.text;
              }
              if (event.type === 'assistant' && event.message?.content) {
                const textBlocks = event.message.content
                  .filter(b => b.type === 'text')
                  .map(b => b.text);
                currentAssistantMessage = textBlocks.join('\n');
              }
            } catch {
              // Not valid JSON — send as raw text
              send({ type: 'assistant.text', content: line });
              currentAssistantMessage += line;
            }
          }
        });

        claudeProcess.stderr.on('data', (chunk) => {
          const text = chunk.toString();
          // Filter out noise
          if (!text.includes('ExperimentalWarning') && text.trim()) {
            send({ type: 'system', message: text.trim() });
          }
        });

        claudeProcess.on('close', (code) => {
          activeProcessCount = Math.max(0, activeProcessCount - 1);
          activeSessions.delete(sessionId);
          claudeProcess = null;

          // Save assistant message
          if (currentAssistantMessage.trim()) {
            appendMessage(conversationDir, 'assistant', currentAssistantMessage);
          }

          send({
            type: 'assistant.done',
            exit_code: code,
            content: currentAssistantMessage,
          });

          // Log completion
          logToSupabase('message_complete', sessionId, `exit: ${code}`);
        });

        claudeProcess.on('error', (err) => {
          activeProcessCount = Math.max(0, activeProcessCount - 1);
          activeSessions.delete(sessionId);
          send({ type: 'error', message: `Claude process error: ${err.message}` });
        });

        break;
      }

      // Cancel current Claude operation
      case 'cancel': {
        if (claudeProcess && !claudeProcess.killed) {
          claudeProcess.kill('SIGTERM');
          setTimeout(() => {
            if (claudeProcess && !claudeProcess.killed) claudeProcess.kill('SIGKILL');
          }, 5000);
          send({ type: 'system', message: 'Cancelling...' });
        }
        break;
      }

      // List available sessions
      case 'sessions.list': {
        const sessions = getStoredSessions();
        send({ type: 'sessions.list', sessions });
        break;
      }

      default:
        send({ type: 'error', message: `Unknown message type: ${msg.type}` });
    }
  });

  ws.on('close', () => {
    // Don't kill the Claude process on disconnect — let it finish
    // User can reconnect and resume
    if (sessionId) {
      log(`Client disconnected from session ${sessionId}`);
    }
  });
});

// ── Stream event handler ──

function handleStreamEvent(event, send) {
  switch (event.type) {
    case 'assistant':
      // Full assistant message — extract content blocks
      if (event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'text') {
            send({ type: 'assistant.text', content: block.text });
          } else if (block.type === 'tool_use') {
            send({
              type: 'tool.call',
              tool: block.name,
              id: block.id,
              input: block.input,
            });
          }
        }
      }
      break;

    case 'content_block_start':
      if (event.content_block?.type === 'tool_use') {
        send({
          type: 'tool.start',
          tool: event.content_block.name,
          id: event.content_block.id,
        });
      }
      break;

    case 'content_block_delta':
      if (event.delta?.text) {
        send({ type: 'assistant.delta', content: event.delta.text });
      } else if (event.delta?.partial_json) {
        send({ type: 'tool.delta', content: event.delta.partial_json });
      }
      break;

    case 'content_block_stop':
      send({ type: 'block.done', index: event.index });
      break;

    case 'result':
      // Final result from claude -p
      send({
        type: 'assistant.text',
        content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
        final: true,
      });
      break;

    default:
      // Forward unknown events for debugging
      send({ type: 'stream.event', event });
  }
}

// ── Session storage helpers ──

function appendMessage(dir, role, content) {
  const msgFile = join(dir, 'messages.jsonl');
  const entry = JSON.stringify({ role, content: content.substring(0, 50000), timestamp: new Date().toISOString() });
  try {
    const existing = existsSync(msgFile) ? readFileSync(msgFile, 'utf8') : '';
    writeFileSync(msgFile, existing + entry + '\n');
  } catch { /* non-fatal */ }
}

function getStoredSessions() {
  try {
    const dirs = readdirSync(SESSIONS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const metaPath = join(SESSIONS_DIR, d.name, 'meta.json');
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
          // Count messages
          const msgPath = join(SESSIONS_DIR, d.name, 'messages.jsonl');
          const msgCount = existsSync(msgPath)
            ? readFileSync(msgPath, 'utf8').trim().split('\n').length
            : 0;
          return { ...meta, message_count: msgCount, active: activeSessions.has(d.name) };
        } catch {
          return { id: d.name, title: 'Unknown', created_at: null, message_count: 0, active: false };
        }
      })
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return dirs;
  } catch {
    return [];
  }
}

// ── Supabase logging ──

async function logToSupabase(eventType, sessionId, description) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/cloud_node_tasks`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        prompt: `[${eventType}] ${description}`,
        status: 'completed',
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      }),
    });
  } catch { /* non-fatal */ }
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Start ──

httpServer.listen(PORT, '127.0.0.1', () => {
  log(`Browning Cloud Node relay listening on 127.0.0.1:${PORT}`);
  log(`Workspace: ${WORKSPACE}`);
  log(`Sessions: ${SESSIONS_DIR}`);
});

// ── HTML Templates ──

function renderLoginPage(error) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Cloud Node</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro',system-ui,sans-serif;background:#0a0a0f;color:#e0e0e0;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{width:100%;max-width:380px;background:#141420;border:1px solid #2a2a3a;border-radius:16px;padding:32px 24px}
h1{font-size:22px;font-weight:700;color:#00d4ff;margin-bottom:2px}
.sub{font-size:13px;color:#555;margin-bottom:28px}
label{font-size:13px;color:#777;display:block;margin-bottom:6px}
input{width:100%;padding:14px 16px;background:#0a0a0f;border:1px solid #2a2a3a;border-radius:10px;color:#fff;font-size:16px;-webkit-appearance:none}
input:focus{outline:none;border-color:#00d4ff}
button{width:100%;padding:14px;background:#00d4ff;color:#000;border:none;border-radius:10px;font-size:16px;font-weight:600;margin-top:16px;cursor:pointer}
button:active{opacity:.8}
.err{color:#ff4444;font-size:13px;margin-top:12px}
</style>
</head>
<body>
<div class="card">
<h1>Cloud Node</h1>
<p class="sub">Browning Digital</p>
<form method="POST" action="/login">
<label>Access Token</label>
<input type="password" name="token" placeholder="Paste token" autocomplete="off" required>
<button type="submit">Connect</button>
${error ? `<p class="err">${error}</p>` : ''}
</form>
</div>
</body>
</html>`;
}

function renderChatUI() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Cloud Node">
<title>Cloud Node</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0a0a0f;--surface:#141420;--border:#1e1e2e;--border-light:#2a2a3a;
  --text:#e0e0e0;--text-dim:#888;--text-faint:#555;
  --accent:#00d4ff;--accent-dim:#0a3a4a;
  --green:#00ff88;--red:#ff4444;--orange:#ffa500;
  --font:-apple-system,BlinkMacSystemFont,'SF Pro',system-ui,sans-serif;
  --mono:'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;
}
html,body{height:100%;overflow:hidden}
body{font-family:var(--font);background:var(--bg);color:var(--text);display:flex;flex-direction:column;height:100dvh}

/* Header */
.header{
  display:flex;align-items:center;justify-content:space-between;
  padding:12px 16px;border-bottom:1px solid var(--border);
  background:var(--bg);flex-shrink:0;z-index:10;
  padding-top:max(12px,env(safe-area-inset-top));
}
.header h1{font-size:17px;font-weight:600;color:var(--accent)}
.header-actions{display:flex;gap:8px;align-items:center}
.status-dot{width:8px;height:8px;border-radius:50%;background:#666;transition:background .3s}
.status-dot.connected{background:var(--green)}
.status-dot.working{background:var(--orange);animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.icon-btn{
  background:none;border:1px solid var(--border-light);color:var(--text-dim);
  width:34px;height:34px;border-radius:8px;display:flex;align-items:center;
  justify-content:center;cursor:pointer;font-size:16px;
}
.icon-btn:active{background:var(--surface)}
.icon-btn.active{border-color:var(--accent);color:var(--accent)}

/* Screen view */
.screen-panel{
  display:none;flex-shrink:0;border-bottom:1px solid var(--border);
  background:#000;position:relative;height:40vh;
}
.screen-panel.open{display:block}
.screen-panel iframe{width:100%;height:100%;border:none}
.screen-panel .screen-toolbar{
  position:absolute;top:8px;right:8px;z-index:5;display:flex;gap:6px;
}
.screen-resize{
  background:rgba(0,0,0,.7);border:1px solid #333;color:#aaa;
  padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;
}

/* Messages area */
.messages{
  flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;
  padding:16px;display:flex;flex-direction:column;gap:12px;
}
.msg{
  max-width:92%;padding:12px 16px;border-radius:16px;
  font-size:15px;line-height:1.5;word-break:break-word;
}
.msg.user{
  align-self:flex-end;background:var(--accent);color:#000;
  border-bottom-right-radius:4px;
}
.msg.assistant{
  align-self:flex-start;background:var(--surface);
  border:1px solid var(--border);border-bottom-left-radius:4px;
}
.msg.system{
  align-self:center;background:none;color:var(--text-faint);
  font-size:12px;padding:4px 12px;
}
.msg.tool{
  align-self:flex-start;background:#0d1117;border:1px solid #1a2332;
  border-radius:10px;font-family:var(--mono);font-size:12px;
  max-width:95%;overflow-x:auto;
}
.tool-label{
  font-size:11px;color:var(--accent);font-weight:600;
  margin-bottom:4px;font-family:var(--font);
}
.msg pre{
  font-family:var(--mono);font-size:13px;white-space:pre-wrap;
  word-break:break-word;margin:6px 0 0;padding:8px;
  background:var(--bg);border-radius:6px;overflow-x:auto;
}
.msg code{
  font-family:var(--mono);font-size:13px;
  background:var(--bg);padding:1px 5px;border-radius:3px;
}
.thinking{
  align-self:flex-start;color:var(--text-faint);font-size:13px;
  padding:8px 16px;display:flex;align-items:center;gap:8px;
}
.thinking .dots span{animation:blink 1.4s infinite both}
.thinking .dots span:nth-child(2){animation-delay:.2s}
.thinking .dots span:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}

/* Input area */
.input-area{
  padding:8px 12px;border-top:1px solid var(--border);
  background:var(--bg);flex-shrink:0;
  padding-bottom:max(8px,env(safe-area-inset-bottom));
}
.input-row{display:flex;gap:8px;align-items:flex-end}
.input-wrap{
  flex:1;background:var(--surface);border:1px solid var(--border-light);
  border-radius:20px;padding:4px 4px 4px 16px;
  display:flex;align-items:flex-end;
}
.input-wrap:focus-within{border-color:var(--accent)}
#prompt{
  flex:1;background:none;border:none;color:var(--text);
  font-size:16px;font-family:var(--font);resize:none;
  max-height:120px;line-height:1.4;padding:8px 0;
  outline:none;
}
#prompt::placeholder{color:var(--text-faint)}
.send-btn{
  width:36px;height:36px;border-radius:50%;border:none;
  background:var(--accent);color:#000;font-size:18px;
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;flex-shrink:0;margin-bottom:2px;
}
.send-btn:disabled{background:var(--border-light);color:var(--text-faint)}
.send-btn:active{opacity:.8}
.cancel-btn{
  width:36px;height:36px;border-radius:50%;border:none;
  background:var(--red);color:#fff;font-size:16px;
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;flex-shrink:0;margin-bottom:2px;
}

/* Sessions sidebar */
.sidebar{
  position:fixed;top:0;left:-100%;width:85%;max-width:320px;
  height:100%;background:var(--surface);z-index:100;
  transition:left .25s ease;border-right:1px solid var(--border);
  display:flex;flex-direction:column;
}
.sidebar.open{left:0}
.sidebar-backdrop{
  position:fixed;top:0;left:0;width:100%;height:100%;
  background:rgba(0,0,0,.6);z-index:99;display:none;
}
.sidebar-backdrop.open{display:block}
.sidebar-header{
  padding:16px;border-bottom:1px solid var(--border);
  display:flex;justify-content:space-between;align-items:center;
  padding-top:max(16px,env(safe-area-inset-top));
}
.sidebar-header h2{font-size:16px;color:var(--accent)}
.sidebar-list{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}
.session-item{
  padding:14px 16px;border-bottom:1px solid var(--border);cursor:pointer;
}
.session-item:active{background:var(--bg)}
.session-item.active{border-left:3px solid var(--accent)}
.session-title{font-size:14px;color:var(--text);margin-bottom:2px}
.session-meta{font-size:11px;color:var(--text-faint)}
.new-session-btn{
  margin:12px 16px;padding:12px;background:var(--accent);
  color:#000;border:none;border-radius:10px;font-size:14px;
  font-weight:600;cursor:pointer;
}
</style>
</head>
<body>

<!-- Sidebar -->
<div class="sidebar-backdrop" id="backdrop" onclick="toggleSidebar()"></div>
<div class="sidebar" id="sidebar">
  <div class="sidebar-header">
    <h2>Sessions</h2>
    <button class="icon-btn" onclick="toggleSidebar()">✕</button>
  </div>
  <div class="sidebar-list" id="sessionList"></div>
  <button class="new-session-btn" onclick="newSession()">New Session</button>
</div>

<!-- Header -->
<div class="header">
  <div style="display:flex;align-items:center;gap:10px">
    <button class="icon-btn" onclick="toggleSidebar()">☰</button>
    <h1 id="sessionTitle">Cloud Node</h1>
  </div>
  <div class="header-actions">
    <button class="icon-btn" id="screenBtn" onclick="toggleScreen()" title="Live screen">🖥</button>
    <div class="status-dot" id="statusDot"></div>
  </div>
</div>

<!-- Screen View (noVNC) -->
<div class="screen-panel" id="screenPanel">
  <div class="screen-toolbar">
    <button class="screen-resize" onclick="resizeScreen('30vh')">S</button>
    <button class="screen-resize" onclick="resizeScreen('50vh')">M</button>
    <button class="screen-resize" onclick="resizeScreen('70vh')">L</button>
  </div>
  <iframe id="screenFrame" src="about:blank" allow="clipboard-read; clipboard-write"></iframe>
</div>

<!-- Messages -->
<div class="messages" id="messages">
  <div class="msg system">Send a message to start a session with Claude Code on your VPS.</div>
</div>

<!-- Input -->
<div class="input-area">
  <div class="input-row">
    <div class="input-wrap">
      <textarea id="prompt" rows="1" placeholder="Message Claude..." enterkeyhint="send"></textarea>
    </div>
    <button class="send-btn" id="sendBtn" onclick="sendMessage()">↑</button>
  </div>
</div>

<script>
const WS_URL = location.protocol === 'https:' ? 'wss://' + location.host : 'ws://' + location.host;
let ws = null;
let sessionId = null;
let isWorking = false;

const messagesEl = document.getElementById('messages');
const promptEl = document.getElementById('prompt');
const sendBtn = document.getElementById('sendBtn');
const statusDot = document.getElementById('statusDot');
const sessionTitle = document.getElementById('sessionTitle');

// Auto-resize textarea
promptEl.addEventListener('input', () => {
  promptEl.style.height = 'auto';
  promptEl.style.height = Math.min(promptEl.scrollHeight, 120) + 'px';
});

// Send on Enter (shift+enter for newline)
promptEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    statusDot.className = 'status-dot connected';
    // Auto-start or resume session
    if (!sessionId) {
      newSession();
    } else {
      ws.send(JSON.stringify({ type: 'session.start', session_id: sessionId }));
    }
  };

  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    handleEvent(data);
  };

  ws.onclose = () => {
    statusDot.className = 'status-dot';
    setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    statusDot.className = 'status-dot';
  };
}

let currentAssistantEl = null;
let currentAssistantText = '';

function handleEvent(data) {
  switch (data.type) {
    case 'session.started':
      sessionId = data.session_id;
      addMsg('system', 'Session started — ' + data.working_dir);
      loadSessions();
      break;

    case 'message.ack':
      addMsg('user', data.content);
      break;

    case 'assistant.thinking':
      showThinking();
      statusDot.className = 'status-dot working';
      isWorking = true;
      updateSendBtn();
      break;

    case 'assistant.delta':
      hideThinking();
      if (!currentAssistantEl) {
        currentAssistantEl = addMsg('assistant', '');
        currentAssistantText = '';
      }
      currentAssistantText += data.content;
      currentAssistantEl.innerHTML = renderMarkdown(currentAssistantText);
      scrollToBottom();
      break;

    case 'assistant.text':
      hideThinking();
      if (data.final && currentAssistantEl) {
        // Final message — already accumulated via deltas
        break;
      }
      if (!currentAssistantEl) {
        currentAssistantEl = addMsg('assistant', '');
        currentAssistantText = '';
      }
      currentAssistantText += data.content;
      currentAssistantEl.innerHTML = renderMarkdown(currentAssistantText);
      scrollToBottom();
      break;

    case 'tool.start':
      hideThinking();
      addMsg('tool', '<div class="tool-label">' + escHtml(data.tool) + '</div>');
      break;

    case 'tool.call':
      hideThinking();
      const inputStr = typeof data.input === 'string'
        ? data.input
        : JSON.stringify(data.input, null, 2);
      addMsg('tool', '<div class="tool-label">' + escHtml(data.tool) + '</div><pre>' + escHtml(inputStr.substring(0, 1000)) + '</pre>');
      break;

    case 'tool.delta':
      // Streaming tool input — could append to last tool msg
      break;

    case 'assistant.done':
      hideThinking();
      currentAssistantEl = null;
      currentAssistantText = '';
      statusDot.className = 'status-dot connected';
      isWorking = false;
      updateSendBtn();
      break;

    case 'system':
      addMsg('system', data.message);
      break;

    case 'error':
      addMsg('system', '⚠ ' + data.message);
      statusDot.className = 'status-dot connected';
      isWorking = false;
      updateSendBtn();
      break;

    case 'sessions.list':
      renderSessionList(data.sessions);
      break;

    case 'stream.event':
      // Debug: uncomment to see raw events
      // console.log('stream event:', data.event);
      break;
  }
}

function sendMessage() {
  const text = promptEl.value.trim();
  if (!text || !ws || ws.readyState !== 1) return;

  if (isWorking) {
    // Cancel current operation
    ws.send(JSON.stringify({ type: 'cancel' }));
    return;
  }

  ws.send(JSON.stringify({ type: 'message', content: text }));
  promptEl.value = '';
  promptEl.style.height = 'auto';
}

function addMsg(role, content) {
  hideThinking();
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  if (role === 'tool') {
    div.innerHTML = content;
  } else if (role === 'assistant') {
    div.innerHTML = renderMarkdown(content);
  } else {
    div.textContent = content;
  }
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

function showThinking() {
  if (document.getElementById('thinking')) return;
  const div = document.createElement('div');
  div.className = 'thinking';
  div.id = 'thinking';
  div.innerHTML = 'Claude is thinking <span class="dots"><span>.</span><span>.</span><span>.</span></span>';
  messagesEl.appendChild(div);
  scrollToBottom();
}

function hideThinking() {
  const el = document.getElementById('thinking');
  if (el) el.remove();
}

function updateSendBtn() {
  if (isWorking) {
    sendBtn.className = 'cancel-btn';
    sendBtn.innerHTML = '■';
    sendBtn.disabled = false;
  } else {
    sendBtn.className = 'send-btn';
    sendBtn.innerHTML = '↑';
    sendBtn.disabled = false;
  }
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

function renderMarkdown(text) {
  // Minimal markdown: code blocks, inline code, bold, links
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre>$1</pre>')
    .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\n/g, '<br>');
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Sessions sidebar
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('backdrop').classList.toggle('open');
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'sessions.list' }));
  }
}

function loadSessions() {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'sessions.list' }));
  }
}

function renderSessionList(sessions) {
  const el = document.getElementById('sessionList');
  el.innerHTML = sessions.map(s => \`
    <div class="session-item \${s.id === sessionId ? 'active' : ''}" onclick="switchSession('\${s.id}')">
      <div class="session-title">\${escHtml(s.title || 'Untitled')}</div>
      <div class="session-meta">\${s.message_count} messages \${s.active ? '• active' : ''}</div>
    </div>
  \`).join('');
}

function switchSession(id) {
  sessionId = id;
  messagesEl.innerHTML = '';
  currentAssistantEl = null;
  currentAssistantText = '';
  toggleSidebar();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'session.start', session_id: id }));
  }
}

function newSession() {
  sessionId = null;
  messagesEl.innerHTML = '';
  currentAssistantEl = null;
  currentAssistantText = '';
  sessionTitle.textContent = 'Cloud Node';
  const id = crypto.randomUUID();
  sessionId = id;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'session.start', session_id: id, title: 'Session ' + new Date().toLocaleTimeString() }));
  }
  const sidebar = document.getElementById('sidebar');
  if (sidebar.classList.contains('open')) toggleSidebar();
}

// Screen view
function toggleScreen() {
  const panel = document.getElementById('screenPanel');
  const btn = document.getElementById('screenBtn');
  const frame = document.getElementById('screenFrame');
  const isOpen = panel.classList.toggle('open');
  btn.classList.toggle('active', isOpen);

  if (isOpen && frame.src === 'about:blank') {
    // noVNC is on the same tunnel, different subdomain
    // The tunnel routes screen.yourdomain.com → localhost:6080
    const screenHost = location.hostname.replace(/^chat\\./, 'screen.');
    frame.src = location.protocol + '//' + screenHost + '/vnc.html?autoconnect=true&resize=scale&quality=5';
  }
}

function resizeScreen(h) {
  document.getElementById('screenPanel').style.height = h;
}

// Init
connect();
</script>
</body>
</html>`;
}
