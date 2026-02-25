# BROWNING SYSTEM — GLOBAL CLAUDE.md
# Applies to every Claude Code session regardless of repo, project, or device.
# Location: ~/.claude/CLAUDE.md

## IDENTITY & ENVIRONMENT

You are working with Devin Browning, founder of Browning Digital.
- OS context: Windows 11 laptop + iPhone 13 (iOS) — never assume Linux paths without checking
- Cloudflare account: devin-b58 (account ID: b58ddf38aeebb77c0ec4c829ea42adf5)
- Supabase project: wcdyvukzlxxkgvxomaxr.supabase.co (admin: devin@browningdigital.com)
- Primary stack: Cloudflare Workers + Supabase + TypeScript
- Storefront/sales stack: Pure HTML/CSS/JS — NO frameworks (see DESIGN PHILOSOPHY below)
- Browning Memory MCP: https://browningdigital.com/api/mcp

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
5. Demand specs before building — never assume requirements
6. Prove it works before closing (deploy and verify, not just compile)
7. Commit reusable workflows to `.claude/commands/`
8. Never micromanage execution — use subagents for compute-heavy work
9. CLAUDE.md self-governs — update it after every correction
10. MCP servers collapse context switching — use them aggressively

---

## TECH STACK DEFAULTS

When no framework is specified, default to:
- **Workers**: TypeScript + Hono + Cloudflare Workers
- **Internal tools/dashboards**: SvelteKit + TailwindCSS + Supabase client (admin panels, internal dashboards ONLY)
- **Database**: Supabase (PostgreSQL) with RLS enabled
- **Auth**: Supabase Auth
- **Deploy**: `wrangler deploy` for Workers, `wrangler pages deploy` for Pages
- **Secrets**: `wrangler secret put` — never hardcode in source

**CRITICAL — Customer-facing pages (storefronts, landing pages, sales funnels, checkout flows, upsell pages) MUST use pure HTML/CSS/JS. No SvelteKit. No React. No Next.js. No framework overhead. Zero build step. CDN-native.**

---

## DESIGN PHILOSOPHY — CONVERSION-FIRST (MANDATORY)

**This section overrides all default frontend decisions for anything a customer sees.**

### The Rule
Never use SvelteKit, React, Next.js, or any JS framework for storefronts, product pages, sales funnels, landing pages, checkout flows, or upsell sequences. Frameworks are for internal tools. Customer-facing pages are raw HTML/CSS/JS — hand-crafted, zero-dependency, deployed straight to Cloudflare Pages with no build step.

### Why
- Frameworks produce generic-looking output. Every SvelteKit site looks like every other SvelteKit site. Devin's brand doesn't blend in — it stands out.
- Speed kills competitors. No hydration, no bundle, no FOUC. The page loads and it's already converting.
- Full control over every pixel, every animation, every micro-interaction. No fighting a component library's opinions.

### What "Conversion-First" Means
Study and apply the patterns that actually sell digital products:
- **Gumroad**: Clean, minimal, product-forward. One CTA. Social proof baked in. No distractions.
- **Sellix**: Dark mode aesthetic, trust signals, instant checkout. Feels exclusive.
- **Shopify high-converters**: Urgency (limited stock, timers), strong hero copy, benefit-driven bullets, sticky mobile CTAs.
- **Drop culture / hype brands**: Scarcity mechanics, waitlists, countdown drops, "sold out" social proof.
- **Viral DTC brands**: Bold typography, motion that draws the eye (not decorates), ruthless copy hierarchy.
- **Loveable / premium SaaS**: Interactive demos inline, value calculators, progressive disclosure.

### Design Principles
1. **Bleeding-edge visuals** — CSS scroll-driven animations, View Transitions API, container queries, `@property` for animated gradients, mesh gradients, glassmorphism done right. Use what browsers ship natively. No polyfills for aesthetics.
2. **Copy hierarchy is king** — The headline sells. The subhead qualifies. The bullets prove. The CTA closes. Everything else is noise. Kill the noise.
3. **Social proof is structural, not decorative** — Purchase counts, testimonials, "X people viewing" — these aren't widgets, they're load-bearing elements of the sales argument.
4. **Mobile-first, thumb-zone optimized** — Sticky bottom CTAs, swipeable galleries, tap targets that respect human fingers. 70%+ of traffic is mobile.
5. **Speed as a feature** — Under 50KB total page weight where possible. Inline critical CSS. Defer nothing the user needs above the fold. No layout shift.
6. **Checkout is sacred** — Minimal fields, multiple payment options visible, trust badges near the pay button, no redirects that break flow. Every extra click loses 20% of buyers.
7. **Upsell while the wallet is open** — Post-purchase upsell pages, order bumps, bundle offers. The moment after "Buy" is the highest-intent moment in the entire funnel.
8. **Dark mode by default** — Premium feel. Easier on eyes. Higher perceived value for digital products. Light mode as an option, never the default.

### What to Reference
When building any sales-facing page, pull conversion patterns from:
- Shopify's highest-grossing themes (Dawn, Prestige, Impulse)
- Gumroad's product page layout and checkout UX
- Sellix's storefront design language
- Stripe Checkout's trust and simplicity patterns
- Apple product pages (progressive disclosure, scroll-triggered reveals)
- Viral product hunt launches (hero → demo → social proof → pricing → FAQ)
- Limited-drop streetwear brands (Fear of God Essentials, Supreme) for urgency/scarcity mechanics

### The Anti-Pattern List (NEVER do these on sales pages)
- Never use a component library (Shadcn, DaisyUI, etc.) — they all look the same
- Never add a navigation bar with 6+ links — it's a sales page, not a portal
- Never use generic stock illustrations or abstract SVG blobs
- Never put the price below the fold on mobile
- Never use a "Learn More" button when you mean "Buy Now"
- Never ship a sales page over 100KB without justification
- Never use loading spinners — if it needs a spinner, it's too slow

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
- **Never use SvelteKit, React, Next.js, or any JS framework for customer-facing sales pages, storefronts, landing pages, or checkout flows** — pure HTML/CSS/JS only. Devin has said this repeatedly. This is non-negotiable.
- Never build a sales page that looks like a template — study what converts, build from scratch, make it pop
