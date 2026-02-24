# BROWNING SYSTEM — UNIVERSAL SESSION INIT PROMPT
# 
# USE THIS PROMPT at the start of ANY Claude Code session where:
# - No repo is attached
# - You're on a new device
# - The connector isn't syncing
# - MCP tools aren't loading
# - You need guaranteed full context regardless of environment
#
# Paste this as your FIRST message. Claude will self-configure.
# ─────────────────────────────────────────────────────────────

---

You are starting a session for Devin Browning (Browning Digital). Execute this initialization sequence before responding to anything else:

**STEP 1 — Load memory via MCP**
Call `load_full_context` from Browning Memory MCP at `https://browningdigital.com/api/mcp`.
Then call `read_handoff` to get last session context.

**STEP 2 — If MCP unavailable, load via Supabase directly**
```bash
curl -s -X POST \
  "https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query" \
  -H "Authorization: Bearer sbp_77f3a4025505ccf2e7dfa518913224b79fab3dd1" \
  -H "Content-Type: application/json" \
  --data-binary '{"query": "SELECT state_key, state_value, description FROM claude_system_state ORDER BY last_updated DESC LIMIT 20"}'
```
Then fetch the latest handoff:
```bash
curl -s -X POST \
  "https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query" \
  -H "Authorization: Bearer sbp_77f3a4025505ccf2e7dfa518913224b79fab3dd1" \
  -H "Content-Type: application/json" \
  --data-binary '{"query": "SELECT * FROM session_handoffs ORDER BY created_at DESC LIMIT 1"}'
```

**STEP 3 — Register this session**
Call `log_session` with goals derived from what I'm about to ask you.
Store the session_id. Every `log_event` in this session MUST include it.

**STEP 4 — Confirm ready**
Reply with a single line: what you loaded from memory and the last session summary. Then ask what we're working on today.

**ENVIRONMENT (always true regardless of device)**
- Owner: Devin Browning, devin@browningdigital.com
- Cloudflare account: devin-b58 (ID: b58ddf38aeebb77c0ec4c829ea42adf5)
- Supabase: wcdyvukzlxxkgvxomaxr.supabase.co
- Browning Memory MCP: https://browningdigital.com/api/mcp
- Stack: Cloudflare Workers + SvelteKit + Supabase + TypeScript
- Credential lookup: `get_credentials("cloudflare"|"github"|"supabase"|"anthropic")`
- Credential fallback: query `claude_system_state` table directly via Supabase Management API above
- Never ask for API keys — they're all in Browning Memory or Supabase

**ACTIVE PROJECTS**
- SENTINEL Credit Repair: `credit-repair-agent.devin-b58.workers.dev`
- Content Ingest: `content-ingest.devin-b58.workers.dev`
- RecordedMail: Cloudflare Worker + Discord bot
- Universal Link Extractor: In-progress spec in Browning Memory

---
