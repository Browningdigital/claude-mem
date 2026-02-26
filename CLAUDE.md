# BROWNING SYSTEM — GLOBAL CLAUDE.md (v2 — Token-Optimized)
# This file loads in EVERY session. Keep it lean. Domain-specific context belongs in per-project files.

## IDENTITY
Devin Browning, founder of Browning Digital.
- OS: Windows 11 laptop + iPhone 13 (iOS)
- Cloudflare: devin-b58 (b58ddf38aeebb77c0ec4c829ea42adf5)
- Supabase: wcdyvukzlxxkgvxomaxr.supabase.co
- Stack: Cloudflare Workers + Supabase + TypeScript
- Customer-facing pages: pure HTML/CSS/JS only (NEVER frameworks)

## CONTEXT LOADING — ON-DEMAND, NOT UPFRONT
Do NOT run a startup ceremony. claude-mem hooks handle local context injection automatically.
- **Local context** (observations, summaries, handoffs) → already injected by SessionStart hook
- **Cross-project state** → use Browning Memory MCP only when the task requires it
- **Credentials** → fetch only when a deploy/API call needs them, not preemptively

## CREDENTIALS — FETCH WHEN NEEDED
Never ask Devin for API keys. Lookup chain:
1. `get_credentials("cloudflare")` via Browning Memory MCP
2. If MCP down → Supabase direct:
```
POST https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query
Authorization: Bearer sbp_77f3a4025505ccf2e7dfa518913224b79fab3dd1
Body: {"query": "SELECT state_value FROM claude_system_state WHERE state_key = '<key>'"}
```
Keys: cloudflare, github, supabase, anthropic, openai, discord, railway, fly
3. If expired → token_creator: `Bearer i83Omnmp5nHvzEjQ55bewLbTGJVrAv8_kFameh4s` at `POST https://api.cloudflare.com/client/v4/accounts/b58ddf38aeebb77c0ec4c829ea42adf5/tokens`
4. Ask Devin only if all 3 fail

## BEHAVIORAL RULES
1. Parallelize independent tasks — don't do sequentially what can run concurrently
2. Challenge your own output before presenting it
3. Demand specs before building — never assume requirements
4. Prove it works before closing (deploy and verify, not just compile)
5. Never commit secrets to git — use `wrangler secret put`
6. Never create a new Cloudflare Worker without checking existing ones first

## TECH STACK DEFAULTS
- Workers: TypeScript + Hono + Cloudflare Workers
- Internal tools: SvelteKit + Tailwind + Supabase (admin panels ONLY)
- Customer-facing: pure HTML/CSS/JS, zero build step, CDN-native, dark mode default
- Database: Supabase PostgreSQL with RLS
- Deploy: `wrangler deploy` (Workers), `wrangler pages deploy` (Pages)

## SESSION END
On session end: `write_handoff` (summarize what was done, state, next steps) + `end_session`
