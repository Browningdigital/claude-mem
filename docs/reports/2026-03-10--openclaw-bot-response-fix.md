# Co-Founder Bot (OpenClaw) — Stopped Responding — March 10, 2026

## Symptom

"The-Co-Founder" Telegram bot (OpenClaw instance on Azure VM) stopped responding to slash commands:
- `/status`, `/restart`, `/stop` sent via Telegram — no response
- Natural language messages had worked up until ~8:50 PM the previous night

## Root Cause

`ANTHROPIC_BASE_URL` was set in `~/.bashrc` on the Azure VM, pointing to OpenRouter (free tier, over quota).

When the co-founder runs in tmux (started via `scripts/start-cofounder.sh`), the tmux session sources `.bashrc`. This means `claude --model sonnet` launches with `ANTHROPIC_BASE_URL` pointing to OpenRouter. When OpenRouter's free quota is exhausted, all Claude API calls fail → Claude Code exits → tmux session goes silent → bot stops responding.

The AI relay (`ai.browningdigital.com`) was also affected: PM2 inherited `ANTHROPIC_BASE_URL` from the environment when it was started. This caused `callClaudeCode()` in `ai-relay/server.js` to fail, silently falling back to Ollama.

## Evidence

- AI relay health: `claude_code: "available"` (relay doesn't know it's broken)
- `POST /generate` with `task_type: "strategy"` returns `routed_to: "ollama", requested: "claude_code"` → confirms fallback
- `bd-agent/memory/2026-03-09.md` had this in the "STILL PENDING" section:
  > Host .bashrc fix — ANTHROPIC_BASE_URL set to OpenRouter (over limit), breaks Claude Code on host machine. Fix: `sed -i '/ANTHROPIC_BASE_URL/d' ~/.bashrc` on host

## Fix Applied (remote, via GitHub API)

**browning-cofounder repo commits:**

1. `scripts/start-cofounder.sh` — Added `unset ANTHROPIC_BASE_URL` before starting Claude Code in tmux
2. `ai-relay/server.js` — Set `ANTHROPIC_BASE_URL: undefined` in the `callClaudeCode` subprocess env

## Required Manual Steps (SSH into Azure VM)

```bash
ssh -i ~/.ssh/id_rsa devin@20.69.157.240

# 1. Fix .bashrc permanently
sed -i '/ANTHROPIC_BASE_URL/d' ~/.bashrc

# 2. Pull the code fixes
cd ~/browning-cofounder && git pull

# 3. Restart the AI relay (picks up the env fix)
pm2 restart ai-relay

# 4. Kill old co-founder session and restart cleanly
tmux kill-session -t cofounder
./scripts/start-cofounder.sh

# 5. Verify bot responds in Telegram
```

## Prevention

- Never set `ANTHROPIC_BASE_URL` in `.bashrc` globally — use per-project `.env` files
- The `start-cofounder.sh` now explicitly unsets it before launching Claude Code
- The relay now passes `ANTHROPIC_BASE_URL: undefined` so PM2 env contamination is ignored
