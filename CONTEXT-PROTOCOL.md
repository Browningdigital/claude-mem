# BROWNING CONTEXT PROTOCOL v2
# How context flows through the Browning Digital Claude ecosystem.
# This is the canonical reference. Update this when the architecture changes.

## ARCHITECTURE OVERVIEW

```
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 1: ALWAYS LOADED (every message, every session)           │
│                                                                   │
│  Global CLAUDE.md (~40 lines, ~500 tokens)                       │
│  └─ Identity, credentials procedure, behavioral rules, stack     │
│                                                                   │
│  claude-mem context injection (SessionStart hook)                 │
│  └─ Recent observations table (IDs, titles, types, token costs)  │
│  └─ Session summaries (what was done, next steps)                │
│  └─ Token economics (savings report)                             │
│  └─ Controlled by: ~/.claude-mem/settings.json                   │
├──────────────────────────────────────────────────────────────────┤
│  LAYER 2: PROJECT-SPECIFIC (loaded per-repo via .claude/CLAUDE.md│
│  or Claude.ai project instructions)                              │
│                                                                   │
│  INFO-PRODUCT-SLIM.md — info product project context (74 lines)  │
│  STOREFRONT-DESIGN.md — conversion-first design rules (50 lines) │
│  cloud-node/agent/CLAUDE.md — autonomous agent identity          │
│  [Add more per-project files as needed]                          │
├──────────────────────────────────────────────────────────────────┤
│  LAYER 3: ON-DEMAND (fetched only when task requires it)         │
│                                                                   │
│  MCP search/timeline/get_observations — deep memory lookup       │
│  Browning Memory MCP — cross-project state, handoffs             │
│  Credentials — API keys from claude_system_state                 │
│  INFO-PRODUCT-PROJECT.md — full 447-line bible (reference only)  │
└──────────────────────────────────────────────────────────────────┘
```

## HOW EACH LAYER LOADS

### Layer 1 — Automatic (zero user action)
- **Global CLAUDE.md**: Loaded by Claude Code from `~/.claude/CLAUDE.md` or repo root
- **claude-mem hooks**: Fire automatically via `plugin/hooks/hooks.json`:
  - `SessionStart` → starts worker + injects context
  - `UserPromptSubmit` → session-init
  - `PostToolUse` → captures observations
  - `Stop` → generates session summary

### Layer 2 — Per-Project (set once per project)
**For Claude Code (CLI):**
- Place project-specific CLAUDE.md in the repo's `.claude/CLAUDE.md`
- claude-mem's `.claude/CLAUDE.md` already auto-generates recent activity

**For Claude.ai (web projects):**
- Paste the slim instructions file into "Project Instructions"
- Upload the full bible as a "Project Knowledge" file (searchable, not in every message)
- Add MCP connectors as needed

### Layer 3 — On-Demand (fetched by Claude when needed)
- claude-mem MCP tools: `search(query)` → `timeline(anchor=ID)` → `get_observations(ids=[...])`
- Browning Memory MCP: `get_credentials()`, `read_handoff()`, `load_full_context()`
- Supabase direct fallback for credentials when MCP is down

## TOKEN BUDGET COMPARISON

| Component | v1 (old) | v2 (new) | Savings |
|-----------|----------|----------|---------|
| Global CLAUDE.md | ~1,500 tok/msg | ~500 tok/msg | 67% |
| Browning Memory startup | ~3,000 tok/session | 0 (on-demand) | 100% |
| Design philosophy | ~800 tok/msg (always) | 0 (per-project only) | 100% |
| Active projects list | ~200 tok/msg | 0 (per-project only) | 100% |
| claude-mem context | ~2,000-5,000 tok | same (tunable via settings) | — |
| **Per-message overhead** | **~7,000-10,000** | **~2,500-5,500** | **~50%** |

## SETTINGS REFERENCE (~/.claude-mem/settings.json)

These control how much context the SessionStart hook injects:

| Setting | Default | Purpose | Token Impact |
|---------|---------|---------|--------------|
| CLAUDE_MEM_CONTEXT_OBSERVATIONS | 50 | Max observations in context | ~50-100 tok each |
| CLAUDE_MEM_CONTEXT_FULL_COUNT | 5 | How many show full narrative | ~500-1000 tok each |
| CLAUDE_MEM_CONTEXT_SESSION_COUNT | 10 | Session summaries to show | ~200 tok each |
| CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS | true | Show read cost column | ~5 tok/row |
| CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS | true | Show work cost column | ~5 tok/row |
| CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT | true | Show savings line | ~20 tok |
| CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT | true | Show savings % | ~10 tok |
| CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY | true | Include most recent session summary | ~200 tok |
| CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE | false | Include last assistant message | ~500+ tok |
| CLAUDE_MEM_CONTEXT_FULL_FIELD | narrative | What field to expand (narrative or facts) | varies |
| CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES | all | Filter by type | reduces rows |
| CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS | all | Filter by concept | reduces rows |

**To reduce token burn further**, tune these in `~/.claude-mem/settings.json`:
```json
{
  "CLAUDE_MEM_CONTEXT_OBSERVATIONS": "25",
  "CLAUDE_MEM_CONTEXT_FULL_COUNT": "3",
  "CLAUDE_MEM_CONTEXT_SESSION_COUNT": "5",
  "CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT": "false",
  "CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT": "false"
}
```

## CONNECTOR SETUP — CLAUDE.AI WEB PROJECTS

### Info Product Project
- **Instructions**: Paste `INFO-PRODUCT-SLIM.md` (74 lines)
- **Knowledge**: Upload `INFO-PRODUCT-PROJECT.md` (full bible)
- **Connectors**: claude-mem MCP (search/timeline), Browning Memory MCP (if needed)

### Storefront / Sales Page Project
- **Instructions**: Paste `STOREFRONT-DESIGN.md` + relevant product context
- **Knowledge**: Upload product specs, brand guidelines
- **Connectors**: claude-mem MCP

### General Coding Project
- **Instructions**: None extra — Global CLAUDE.md + claude-mem hooks handle it
- **Knowledge**: None
- **Connectors**: claude-mem MCP

### Autonomous Agent (Cloud Node)
- **Instructions**: `cloud-node/agent/CLAUDE.md` (already 11.6KB — has its own identity)
- **Knowledge**: Product pipeline docs
- **Connectors**: Browning Memory MCP (for handoffs + cross-session state)

## FILE INVENTORY

| File | Lines | Where to Use | Purpose |
|------|-------|--------------|---------|
| `CLAUDE.md` (root) | ~40 | Global (~/.claude/) | Identity + credentials + rules |
| `INFO-PRODUCT-SLIM.md` | 74 | Claude.ai project instructions | Info product project context |
| `INFO-PRODUCT-PROJECT.md` | 447 | Claude.ai project knowledge | Full operational bible |
| `STOREFRONT-DESIGN.md` | 50 | Claude.ai project instructions | Conversion-first design rules |
| `CONTEXT-PROTOCOL.md` | this file | Reference only | Architecture documentation |
| `cloud-node/agent/CLAUDE.md` | ~300 | Agent project instructions | Autonomous agent identity |
| `browning-session-init.md` | 62 | Paste manually (no-repo/mobile) | Emergency bootstrap when nothing loads |

## PRINCIPLES

1. **Load what you need, when you need it.** No startup ceremonies.
2. **Global file = identity + credentials + rules.** Everything else is per-project.
3. **claude-mem handles local context automatically.** Don't duplicate its work.
4. **Layer 3 is the deep bench.** Full details, credentials, cross-project state — fetch on demand.
5. **Measure token spend.** claude-mem's economics display shows exactly what context costs.
6. **This protocol self-governs.** Update it when the architecture changes.
