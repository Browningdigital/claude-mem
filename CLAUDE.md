# BROWNING SYSTEM — GLOBAL CLAUDE.md
# Applies to every Claude Code session regardless of repo, project, or device.
# Location: ~/.claude/CLAUDE.md

## IDENTITY & ENVIRONMENT

You are working with Devin Browning, founder of Browning Digital.
- OS context: Windows 11 laptop + iPhone 13 (iOS) — never assume Linux paths without checking
- Cloudflare account: devin-b58 (account ID: b58ddf38aeebb77c0ec4c829ea42adf5)
- Supabase project: wcdyvukzlxxkgvxomaxr.supabase.co (admin: devin@browningdigital.com)
- Primary stack: Cloudflare Workers + SvelteKit + Supabase + TypeScript
- Browning Memory MCP: https://browning-mcp.devin-b58.workers.dev/mcp_browning_29870c04fb6671e43b0117187c4295c5a79fd8fbd4e461af

---

## STARTUP SEQUENCE (MANDATORY — EVERY SESSION)

Execute this on the FIRST user message of every session, before doing anything else:

### Step 1 — Load Browning Memory context
Call the `load_full_context` tool from Browning Memory MCP.
If MCP is unavailable, skip to FALLBACK below.

### Step 2 — Register session
Call `log_session` with the session goals inferred from the first message.
Store the returned session_id — pass it to EVERY subsequent `log_event` call.

### Step 3 — Read handoff
Call `read_handoff` to load context from previous session.

If all 3 steps succeed: proceed normally with full memory context.

---

## MCP FALLBACK (when Browning Memory tools return errors or "not found")

MCP connections in claude.ai drop on long conversations — this is expected behavior.

When MCP fails, use the Supabase Management API directly:

```
ENDPOINT: https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query
METHOD: POST
AUTH: Bearer sbp_77f3a4025505ccf2e7dfa518913224b79fab3dd1
BODY: { "query": "SQL HERE" }
```

**Reading credentials when MCP is down:**
```bash
curl -s -X POST \
  "https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query" \
  -H "Authorization: Bearer sbp_77f3a4025505ccf2e7dfa518913224b79fab3dd1" \
  -H "Content-Type: application/json" \
  --data-binary '{"query": "SELECT state_key, state_value FROM claude_system_state WHERE state_key = '\''cloudflare_credentials'\''"}'
```

Replace `cloudflare_credentials` with any of: `supabase_credentials`, `github_credentials`, `anthropic_credentials`, `openai_credentials`, `discord_credentials`, `railway_credentials`, `fly_credentials`.

Short aliases also work: `cloudflare`, `github`, `supabase`, `anthropic`, `openai`, `discord`.

---

## CREDENTIAL LOOKUP PROCEDURE

**Never ask Devin for API keys.** Always retrieve them from Browning Memory first, Supabase direct second.

1. Try: `get_credentials("cloudflare")` via Browning Memory MCP
2. If MCP down: use Supabase curl above
3. If key is expired/revoked: use token_creator to auto-generate a new scoped token
   - token_creator: `Authorization: Bearer i83Omnmp5nHvzEjQ55bewLbTGJVrAv8_kFameh4s`
   - endpoint: `POST https://api.cloudflare.com/client/v4/accounts/b58ddf38aeebb77c0ec4c829ea42adf5/tokens`
4. Only ask Devin if all 3 steps fail

---

## SESSION LOGGING (MANDATORY)

Every `log_event` call MUST include `session_id`. Missing session_id = orphaned event = lost history.

```
log_event({
  description: "what happened",
  event_type: "action|decision|milestone|insight|error|discovery",
  importance: "low|medium|high",
  session_id: <session_id from Step 2 above>  ← REQUIRED
})
```

On session END (always, even if interrupted):
1. `write_handoff` — summarize what was done, current state, next steps
2. `end_session` — mark completed with outcomes

---

## BEHAVIORAL COMMANDMENTS

1. Read Browning Memory context before writing a single line of code
2. Plan in headless mode before touching files
3. Parallelize independent tasks — don't do sequentially what can run concurrently
4. Challenge your own output before presenting it
5. Demand specs before building — never assume requirements. But once you have specs AND direction is confirmed, execute immediately — never ask "Do both?", "Shall I proceed?", "Want me to do X?" — those are stall questions. If you know what to do, do it.
6. Prove it works before closing (deploy and verify, not just compile)
7. Commit reusable workflows to `.claude/commands/`
8. Never micromanage execution — use subagents for compute-heavy work
9. CLAUDE.md self-governs — update it after every correction
10. MCP servers collapse context switching — use them aggressively
11. Diagnosis ≠ action. Don't spend two messages diagnosing and then ask permission to fix. Diagnose once, fix immediately after unless genuinely blocked on missing info.

---

## TECH STACK DEFAULTS

When no framework is specified, default to:
- **Workers**: TypeScript + Hono + Cloudflare Workers
- **Frontend**: SvelteKit + TailwindCSS + Supabase client
- **Database**: Supabase (PostgreSQL) with RLS enabled
- **Auth**: Supabase Auth
- **Deploy**: `wrangler deploy` for Workers, `wrangler pages deploy` for Pages
- **Secrets**: `wrangler secret put` — never hardcode in source

---

## ACTIVE PROJECTS (as of Feb 2026)

- **Credit Repair C&C / SENTINEL**: `credit-repair-agent.devin-b58.workers.dev` | dashboard: `credit-system-admin.pages.dev` | DB: `wcdyvukzlxxkgvxomaxr`
- **Content Ingest / Autonomous Engine v5**: `content-ingest.devin-b58.workers.dev`
- **RecordedMail**: Cloudflare Worker + Discord bot (RM Operations, app ID 1468066515709333739)
- **Browning Memory MCP**: `browningdigital.com/api/mcp` — the memory system itself
- **Universal Link Extractor**: In-progress build, spec in Browning Memory

---

## NEVER DO

- Never ask for API keys Devin already has stored
- Never use `localhost` paths as if running on Windows when on iOS/mobile
- Never create a new Cloudflare Worker without checking existing ones first
- Never commit secrets to git — always use `wrangler secret put`
- Never skip `write_handoff` at session end
- Never log events without `session_id`
