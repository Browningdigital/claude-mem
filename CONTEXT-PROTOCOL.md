# BROWNING CONTEXT PROTOCOL v2
# How context flows through the Browning Digital Claude ecosystem.
# This is the canonical reference. Update this when the architecture changes.

## ARCHITECTURE OVERVIEW

```
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 1: ALWAYS LOADED (every message, every session)           │
│                                                                   │
│  Global CLAUDE.md (197 lines, ~1,500 tokens)                     │
│  └─ Identity, environment, startup sequence, credentials         │
│  └─ MCP fallback, session logging, behavioral commandments       │
│  └─ Tech stack defaults, design philosophy, active projects      │
│                                                                   │
│  claude-mem context injection (SessionStart hook)                 │
│  └─ Recent observations table (IDs, titles, types, token costs)  │
│  └─ Session summaries (what was done, next steps)                │
│  └─ Token economics (savings report)                             │
│  └─ Controlled by: ~/.claude-mem/settings.json                   │
├──────────────────────────────────────────────────────────────────┤
│  LAYER 2: PROJECT-SPECIFIC (loaded per-repo .claude/CLAUDE.md    │
│  or Claude.ai project instructions)                              │
│                                                                   │
│  STOREFRONT-DESIGN.md — conversion-first design reference        │
│  cloud-node/agent/CLAUDE.md — autonomous agent identity          │
│  [Per-project files as needed]                                   │
├──────────────────────────────────────────────────────────────────┤
│  LAYER 3: ON-DEMAND (fetched only when task requires it)         │
│                                                                   │
│  claude-mem MCP: search/timeline/get_observations                │
│  Browning Memory MCP: credentials, handoffs, cross-project state │
│  Supabase direct fallback when MCP is down                       │
└──────────────────────────────────────────────────────────────────┘
```

## TOKEN BURN PER MESSAGE (defaults)

| Source | Tokens | Lever |
|--------|--------|-------|
| Global CLAUDE.md | ~1,500 | Fixed (Claude Code loads it) |
| claude-mem header (legend, column key, context index) | ~250 | **CLAUDE_MEM_CONTEXT_COMPACT** |
| Observation index rows (50 × ~50 tok) | ~2,500 | **CLAUDE_MEM_CONTEXT_OBSERVATIONS** |
| Full observation narratives (5 × ~500-1000 tok) | ~2,500-5,000 | **CLAUDE_MEM_CONTEXT_FULL_COUNT** |
| Session summaries (10 × ~200 tok) | ~2,000 | **CLAUDE_MEM_CONTEXT_SESSION_COUNT** |
| Last summary + footer | ~250 | SHOW_LAST_SUMMARY, economics toggles |
| **TOTAL (defaults)** | **~9,000-11,500** | |

## SETTINGS REFERENCE (~/.claude-mem/settings.json)

### Display Counts (biggest token impact)

| Setting | Default | Purpose | Token Impact |
|---------|---------|---------|--------------|
| CLAUDE_MEM_CONTEXT_OBSERVATIONS | 50 | Max observations in context | ~50 tok/row |
| CLAUDE_MEM_CONTEXT_FULL_COUNT | 5 | How many show full narrative | ~500-1000 tok each |
| CLAUDE_MEM_CONTEXT_SESSION_COUNT | 10 | Session summaries to show | ~200 tok each |
| CLAUDE_MEM_CONTEXT_COMPACT | false | **Strip column key + context index boilerplate** | **~250 tok saved** |

### Token Display Toggles

| Setting | Default | Purpose | Token Impact |
|---------|---------|---------|--------------|
| CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS | true | Show read cost column | ~5 tok/row |
| CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS | true | Show work cost column | ~5 tok/row |
| CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT | true | Show savings line | ~20 tok |
| CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT | true | Show savings % | ~10 tok |

### Feature Toggles

| Setting | Default | Purpose | Token Impact |
|---------|---------|---------|--------------|
| CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY | true | Include most recent session summary | ~200 tok |
| CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE | false | Include last assistant message | ~500+ tok |
| CLAUDE_MEM_CONTEXT_FULL_FIELD | narrative | What field to expand (narrative or facts) | varies |
| CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES | all | Filter by type | reduces rows |
| CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS | all | Filter by concept | reduces rows |

## RECOMMENDED PROFILES

### Aggressive Token Saver (~4,500-6,500 tok total)
For heavy building sessions where you need max throughput:
```json
{
  "CLAUDE_MEM_CONTEXT_OBSERVATIONS": "25",
  "CLAUDE_MEM_CONTEXT_FULL_COUNT": "2",
  "CLAUDE_MEM_CONTEXT_SESSION_COUNT": "5",
  "CLAUDE_MEM_CONTEXT_COMPACT": "true",
  "CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT": "false",
  "CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT": "false"
}
```

### Balanced (defaults — ~9,000-11,500 tok total)
Full context for research-heavy sessions:
```json
{
  "CLAUDE_MEM_CONTEXT_OBSERVATIONS": "50",
  "CLAUDE_MEM_CONTEXT_FULL_COUNT": "5",
  "CLAUDE_MEM_CONTEXT_SESSION_COUNT": "10",
  "CLAUDE_MEM_CONTEXT_COMPACT": "false"
}
```

## HOW IT WORKS

### SessionStart Hook Sequence
1. `smart-install.js` — Install dependencies
2. `worker-service.cjs start` — Boot worker daemon
3. `worker-service.cjs hook claude-code context` — Generate + inject context
4. `worker-service.cjs hook claude-code user-message` — Attach user-message handler

### Context Generation Flow
```
hook claude-code context
  → context handler (src/cli/handlers/context.ts)
  → GET /api/context/inject?projects=...
  → ContextBuilder.generateContext()
    → ContextConfigLoader.loadContextConfig()  ← reads ~/.claude-mem/settings.json
    → ObservationCompiler.queryObservations()   ← filtered by type/concept settings
    → HeaderRenderer.renderHeader()             ← compact mode skips boilerplate
    → TimelineRenderer.renderTimeline()
    → SummaryRenderer.renderSummaryFields()
    → FooterRenderer.renderFooter()
  → output injected into session as additionalContext
```

### Data Flow
- All data stays in SQLite (`~/.claude-mem/claude-mem.db`)
- Settings control what gets LOADED, never what gets STORED
- MCP tools provide on-demand deep access to anything not in the context window
- Nothing is deleted — the delivery layer decides what's relevant per session

## PRINCIPLES

1. **All data stays.** Settings control delivery, not storage.
2. **Measure what you load.** Token economics show exactly what context costs.
3. **Tune for the task.** Aggressive saver for building, balanced for research.
4. **Compact mode strips what Claude already knows.** Column key and context index instructions are boilerplate after the first session.
5. **Layer 3 is the deep bench.** Full details available on-demand via MCP tools.
6. **This protocol self-governs.** Update it when the architecture changes.
