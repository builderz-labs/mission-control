# AI Town × Mission Control — Integration Analysis

## Executive Summary

This document analyzes the feasibility, risks, and strategy for integrating [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town) concepts and code into OpenClaw Mission Control v1.3.0. AI Town provides a proven simulation engine for autonomous LLM-powered agents with spatial movement, multi-turn conversations, and memory formation. Mission Control already has a virtual office, agent management, chat, and real-time infrastructure — making this an **enhancement integration**, not a ground-up build.

**Verdict**: High-value, medium-risk. The core concepts (tick-based simulation, memory architecture, conversation lifecycle) map cleanly onto MC's existing abstractions. The primary risk is backend divergence (Convex vs SQLite/Next.js API routes), which requires a translation layer rather than a direct port.

---

## 1. Architecture Comparison

| Dimension | AI Town | Mission Control | Gap |
|-----------|---------|----------------|-----|
| **Backend** | Convex (serverless reactive DB) | Next.js API routes + SQLite (better-sqlite3) | **Large** — different paradigms |
| **Frontend** | React 18 + Vite + PixiJS | React 19 + Next.js 16 + Tailwind | Medium — React compatible |
| **Rendering** | PixiJS (pixel-art sprites, tile map) | CSS/SVG isometric office (DOM-based) | Medium — different approach |
| **Real-time** | Convex built-in reactivity (auto-sync) | SSE + WebSocket + polling | Small — MC already has 3 tiers |
| **Database** | Convex document DB | SQLite with WAL mode | **Large** — different models |
| **Agent behavior** | Tick-based engine (60 ticks/s) | API-driven status updates | **Large** — no game loop |
| **Conversations** | 3-phase LLM (start/continue/leave) | Text messages with types | Medium — structure exists |
| **Memory** | Stanford paper (observe/reflect/relate) | Key-value sovereign memory | **Large** — fundamentally different |
| **Pathfinding** | A* on tile grid, collision detection | Zone-based seat assignment, smooth easing | Medium — different movement model |
| **Auth** | Clerk (optional) | Local password + Google OAuth | Small — independent |
| **LLM** | Ollama/OpenAI/Together (abstracted) | Not integrated (agents are external) | Medium — need LLM layer |
| **License** | MIT | MIT (assumed) | None |

### Key Insight
AI Town is a **simulation engine** — agents run autonomously inside a game loop. Mission Control is an **orchestration dashboard** — agents are external processes (Claude Code sessions) that MC monitors and coordinates. The integration bridges these paradigms: MC gains autonomous agent behaviors while keeping its dashboard identity.

---

## 2. What to Port (and What Not To)

### PORT — High Value

| Component | AI Town Source | MC Target | Rationale |
|-----------|---------------|-----------|-----------|
| **Memory architecture** | `convex/agent/memory.ts` | New `src/lib/agent-memory.ts` | Stanford paper's observe/reflect/relate model is battle-tested and far superior to key-value store |
| **Conversation lifecycle** | `convex/agent/conversation.ts` | Extend `src/app/api/chat/` routes | 3-phase (start/continue/leave) with personality injection adds depth to agent chat |
| **Agent decision loop** | `convex/aiTown/agentOperations.ts` | New `src/lib/agent-brain.ts` | LLM-powered "what should I do next?" gives agents autonomy |
| **Memory retrieval scoring** | `convex/agent/memory.ts` (composite score) | Part of agent-memory.ts | `relevance + importance + recency` formula is well-researched |
| **Importance scoring** | LLM rates memories 0-9 "poignancy" | Part of agent-memory.ts | Enables reflection triggers |
| **Reflection generation** | When importance > 500, generate insights | Part of agent-memory.ts | Higher-order reasoning from accumulated experience |

### ADAPT — Needs Translation

| Component | AI Town Approach | MC Adaptation | Why Adapt |
|-----------|-----------------|---------------|-----------|
| **Tick engine** | 60 ticks/s in Convex action | Cron-based step every 1-5s via `/api/simulation/tick` | MC doesn't need 60fps game precision; 1-5s intervals suffice |
| **Pathfinding** | A* on tile collision grid | Enhance existing zone-based movement with smoother transitions | MC's isometric office is DOM-based, not tile-based |
| **Conversation invites** | Proximity-based (agent walks to target) | Intent-based (agent chooses who to talk to based on role/context) | MC agents don't have tile positions |
| **World state** | Single Convex document with all entities | SQLite tables (agents, tasks, messages) — already exists | MC's relational model is fine; no need for document model |
| **Real-time sync** | Convex reactive queries | SSE broadcasts (already exists) | MC's SSE is adequate |

### SKIP — Low Value or Incompatible

| Component | Reason to Skip |
|-----------|---------------|
| **Convex backend** | Adds massive dependency, duplicates MC's entire backend |
| **PixiJS rendering** | MC's CSS/SVG office works well; PixiJS is a different visual language |
| **Tile map system** | MC uses zone-based layout, not tile grids |
| **Human player joining** | MC is a dashboard, not a game; humans observe, not play |
| **Music generation** | Not relevant to agent orchestration |
| **Historical value interpolation** | Over-engineered for MC's 1-5s update frequency |
| **Clerk auth** | MC has its own auth system |

---

## 3. Integration Architecture

### Phase 1: Agent Memory System (Foundation)

Replace sovereign memory's flat KV store with AI Town's memory architecture, adapted for SQLite.

```
┌─────────────────────────────────────────────────┐
│                 Agent Memory                     │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │Observation│  │Reflection│  │ Relationship  │  │
│  │ Memories  │  │ Memories │  │   Memories    │  │
│  └─────┬────┘  └─────┬────┘  └──────┬───────┘  │
│        │             │               │           │
│        └─────────────┼───────────────┘           │
│                      ▼                           │
│            ┌──────────────┐                      │
│            │Vector Search │  (SQLite FTS5 or     │
│            │  + Scoring   │   external embeddings)│
│            └──────────────┘                      │
│                      │                           │
│         score = relevance + importance + recency │
└─────────────────────────────────────────────────┘
```

**New tables:**
```sql
CREATE TABLE agent_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL REFERENCES agents(id),
  type TEXT NOT NULL CHECK(type IN ('observation', 'reflection', 'relationship')),
  description TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 0,  -- 0-9 poignancy score
  last_access INTEGER NOT NULL,
  related_agent_id INTEGER,               -- for relationship type
  source_memory_ids TEXT,                  -- JSON array, for reflections
  workspace_id INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE agent_memory_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id INTEGER NOT NULL REFERENCES agent_memories(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,                -- float32 array as blob
  text_hash TEXT NOT NULL
);

CREATE INDEX idx_agent_memories_agent ON agent_memories(agent_id, type);
CREATE INDEX idx_agent_memories_importance ON agent_memories(importance DESC);
```

**Embedding strategy**: Use SQLite FTS5 for text similarity as baseline. Optionally support external embedding API (OpenAI/Ollama) with vector storage in `agent_memory_embeddings` and cosine similarity in application code.

### Phase 2: Conversation Lifecycle

Extend the existing chat system with AI Town's 3-phase conversation model.

```
┌─────────────┐    ┌────────────────┐    ┌────────────────┐
│   START      │───▶│   CONTINUE     │───▶│    LEAVE       │
│              │    │                │    │                │
│ - Fetch      │    │ - Load history │    │ - Generate     │
│   identities │    │ - Inject       │    │   farewell     │
│ - Retrieve   │    │   personality  │    │ - Store        │
│   memories   │    │ - Generate     │    │   memory of    │
│ - Generate   │    │   response     │    │   conversation │
│   opener     │    │ - Check limits │    │ - Trigger      │
│              │    │   (8 msgs or   │    │   reflection   │
│              │    │    10 min)     │    │   if threshold │
└─────────────┘    └────────────────┘    └────────────────┘
```

**Changes to existing chat:**
- Add `conversation_phase` column to messages table: `'start' | 'continue' | 'leave'`
- Add `agent_personality` field to agent config (soul_content already exists — use it)
- New API route: `POST /api/agents/[id]/converse` — triggers LLM conversation generation
- Conversation limits: max 8 messages or 10 minutes (configurable)

### Phase 3: Agent Decision Engine

A lightweight simulation loop that gives agents autonomy.

```
┌───────────────────────────────────────────────┐
│            Simulation Tick (every 5s)          │
│                                                │
│  For each idle agent:                          │
│    1. Check: any pending tasks? → work on task │
│    2. Check: conversation to remember? → store │
│    3. Check: reflection threshold? → reflect   │
│    4. Otherwise: agentDoSomething()            │
│       - Walk to activity zone                  │
│       - Start conversation with nearby agent   │
│       - Continue current activity              │
│                                                │
│  Cooldowns:                                    │
│    - 15s between conversations                 │
│    - 60s between same-agent conversations      │
│    - 10s between activity changes              │
└───────────────────────────────────────────────┘
```

**Implementation:**
- New `src/lib/simulation-engine.ts` — runs as a managed interval (NOT module-level; lazy-init pattern per S5/S6 fixes)
- Each tick: load agents, evaluate state, dispatch async LLM calls
- LLM calls happen in background (fire-and-forget with timeout)
- Results written back via existing API routes → SSE broadcast → UI updates
- Engine disabled by default; enabled via config flag `SIMULATION_ENABLED=true`

### Phase 4: Enhanced Office Visualization

Upgrade the virtual office to reflect agent behaviors.

- **Conversation bubbles**: Show speech snippets when agents are conversing
- **Activity indicators**: Visual cues for what agents are doing (coding, reviewing, thinking)
- **Memory indicators**: Subtle glow when an agent is forming a memory or reflecting
- **Movement intent**: Agents move toward conversation partners before chatting
- **Status transitions**: Smooth animations when agents change from idle→busy→conversing

---

## 4. Risk Prevention Analysis

### R1: CRITICAL — LLM Cost Explosion

**Risk**: Autonomous agents calling LLMs every 5 seconds across all agents.
**Impact**: $100+/day easily with GPT-4 class models.

**Mitigations:**
- Hard budget cap per agent per day (configurable, default $5)
- Token usage tracked in existing `token_usage` table
- Rate limiting: max 1 LLM call per agent per 30 seconds
- Model tiering: use cheap models (Haiku/GPT-4o-mini) for decisions, expensive models only for important conversations
- Dry-run mode: log what the agent *would* do without calling LLM
- Kill switch: `SIMULATION_ENABLED=false` stops all autonomous behavior

### R2: HIGH — SQLite Concurrency Under Simulation Load

**Risk**: 60+ writes/second from simulation ticks + SSE broadcasts + API routes.
**Impact**: WAL mode handles concurrent reads well, but write contention could cause `SQLITE_BUSY` errors.

**Mitigations:**
- Batch tick writes: accumulate state changes, write once per tick (not per-agent)
- WAL mode already enabled (good)
- Add `busy_timeout` pragma (5000ms) to prevent immediate failures
- Monitor write latency; add circuit breaker if >100ms average
- Consider read replicas (litestream) for dashboard queries if needed

### R3: HIGH — Memory Table Bloat

**Risk**: Each conversation generates memories + embeddings. 10 agents × 10 conversations/day × 365 days = 36,500 memories/year with embeddings.
**Impact**: SQLite performance degrades; embedding search becomes slow.

**Mitigations:**
- Vacuum old memories (AI Town's 2-week `VACUUM_MAX_AGE` pattern)
- Importance-weighted retention: keep high-importance memories longer
- Embedding cache with TTL (AI Town's `embeddingsCache` pattern)
- FTS5 index for text search (fast, no external dependency)
- Archive table for old memories (queryable but not in hot path)

### R4: MEDIUM — Agent Behavior Unpredictability

**Risk**: LLM-driven agents may generate inappropriate, off-topic, or conflicting behaviors.
**Impact**: Dashboard shows confusing or harmful agent interactions.

**Mitigations:**
- System prompt guardrails: strict persona + behavioral boundaries
- Content filtering on generated messages before display
- Human-in-the-loop: require approval for certain action types (e.g., task creation)
- Audit log: all LLM calls and responses logged for review
- Personality templates with tested, safe defaults

### R5: MEDIUM — Integration Complexity Creep

**Risk**: Porting AI Town concepts leads to scope expansion, touching too many files.
**Impact**: Regression risk, hard to review, long time-to-ship.

**Mitigations:**
- Strict phased approach: each phase is independently shippable
- Feature flags for each phase (`MEMORY_V2_ENABLED`, `CONVERSATION_LIFECYCLE_ENABLED`, `SIMULATION_ENABLED`)
- All new code in dedicated files (no modification of existing working code in Phase 1-2)
- Existing tests must continue to pass at every phase
- New code gets its own test files

### R6: LOW — Convex Dependency Temptation

**Risk**: Developer temptation to bring in Convex as a dependency for "easier" integration.
**Impact**: Dual-database architecture, deployment complexity, cost.

**Mitigation**: Hard rule — NO Convex dependency. All AI Town concepts are translated to SQLite + Next.js API routes. The value is in the algorithms and patterns, not the platform.

### R7: LOW — Embedding Dimension Mismatch

**Risk**: Different LLM providers produce different embedding dimensions (768, 1024, 1536).
**Impact**: Cannot mix memories embedded by different models.

**Mitigations:**
- Store `embedding_model` alongside each embedding
- Reject similarity queries across different models
- Default to a single configurable model (e.g., `text-embedding-3-small` at 1536 dims)
- Migration path: re-embed on model change

---

## 5. Success Metrics

### Functional Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Memory retrieval accuracy | >80% relevant in top-5 results | Manual review of 50 sample queries |
| Conversation coherence | >90% of generated messages are contextually appropriate | Human evaluation of 100 random messages |
| Reflection quality | >70% of reflections capture meaningful insights | Manual review of generated reflections |
| Decision appropriateness | >85% of autonomous decisions are reasonable | Audit log review of 200 decisions |
| Simulation stability | 0 crashes over 24h continuous run | Automated stability test |
| Memory retrieval latency | <200ms p95 | Application metrics |
| Tick processing time | <1s per tick (all agents) | Timer logs |

### Quality Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Test coverage (new code) | >80% line coverage | Vitest coverage report |
| Type safety | 0 `as any` in new code | ESLint rule + manual review |
| Build health | lint 0, typecheck 0, tests pass, build succeeds | CI quality gate |
| API consistency | All new routes follow existing patterns (Zod validation, error handling) | Code review |
| Memory usage | <100MB additional RAM under simulation | Process monitoring |
| DB size growth | <50MB/month with 10 active agents | SQLite file size tracking |

### Business/UX Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Agent interactions feel natural | >4/5 user rating | User survey after demo |
| Dashboard remains responsive | <100ms interaction latency | Lighthouse + manual testing |
| Office visualization enriched | Users report improved spatial awareness | Qualitative feedback |
| Configuration complexity | <5 env vars to enable full simulation | Documentation review |
| Time to onboard new agent | <2 minutes from creation to first autonomous action | Timed test |

---

## 6. Quality Gates Per Phase

### Phase 1 (Memory System) — Exit Criteria
- [ ] `agent_memories` + `agent_memory_embeddings` tables created via migration
- [ ] `agent-memory.ts` with: `observe()`, `reflect()`, `recall()`, `scoreMemory()`
- [ ] Importance scoring via LLM (with fallback to keyword heuristic)
- [ ] FTS5 text similarity search working
- [ ] 20+ unit tests covering all memory operations
- [ ] Sovereign memory preserved (backward compatible)
- [ ] Build passes full quality gate

### Phase 2 (Conversations) — Exit Criteria
- [ ] 3-phase conversation flow (start/continue/leave) implemented
- [ ] Personality injection from agent `soul_content`
- [ ] Memory retrieval integrated into conversation context
- [ ] Conversation limits enforced (8 messages, 10 minutes)
- [ ] Post-conversation memory formation (summarize + store)
- [ ] 15+ unit tests + 5 E2E tests
- [ ] Existing chat functionality unchanged
- [ ] Build passes full quality gate

### Phase 3 (Simulation Engine) — Exit Criteria
- [ ] `simulation-engine.ts` with managed lifecycle (start/stop/pause)
- [ ] Tick loop processing all agents every 5s (configurable)
- [ ] Agent decision tree: task → remember → reflect → do something
- [ ] Cooldown enforcement between actions
- [ ] Budget/rate limiting per agent
- [ ] Kill switch via env var + API endpoint
- [ ] 20+ unit tests + stability test (1000 ticks without error)
- [ ] Build passes full quality gate

### Phase 4 (Visualization) — Exit Criteria
- [ ] Conversation bubbles visible in office when agents chat
- [ ] Activity indicators on agent sprites
- [ ] Smooth status transitions in office view
- [ ] No regression in office panel performance (measure FPS/jank)
- [ ] Build passes full quality gate

---

## 7. Dependency Map

```
Phase 1: Memory System
    ↓ (memories required for conversation context)
Phase 2: Conversation Lifecycle
    ↓ (conversations required for autonomous behavior)
Phase 3: Simulation Engine
    ↓ (simulation state drives visualization)
Phase 4: Office Visualization
```

Phases are strictly sequential. Each phase is independently valuable:
- **Phase 1 alone**: Agents have persistent memory (useful for context across sessions)
- **Phase 1+2**: Agents can have rich conversations with memory context
- **Phase 1+2+3**: Agents are fully autonomous
- **Phase 1+2+3+4**: Full visual experience

---

## 8. Estimated Scope

| Phase | New Files | Modified Files | New Tests | New Migrations | Risk |
|-------|-----------|---------------|-----------|----------------|------|
| 1 — Memory | 3-4 | 1-2 | 20-25 | 1 | Low |
| 2 — Conversations | 3-4 | 2-3 | 15-20 | 1 | Medium |
| 3 — Simulation | 2-3 | 3-4 | 25-30 | 0 | High |
| 4 — Visualization | 2-3 | 3-4 | 5-10 | 0 | Low |
| **Total** | **10-14** | **9-13** | **65-85** | **2** | — |

---

## 9. External Dependencies Required

| Dependency | Purpose | Required? | Alternative |
|------------|---------|-----------|-------------|
| OpenAI API (or compatible) | Embedding generation + LLM decisions | Yes (for Phase 1+) | Ollama (local, free) |
| `better-sqlite3` (existing) | Memory storage | Already installed | — |
| None new in package.json | — | — | FTS5 is built into SQLite |

**No new npm dependencies required** for Phase 1-3. Phase 4 may optionally add animation libraries if CSS transitions are insufficient.

---

## 10. Open Questions

1. **Embedding provider**: Ollama (free, local, needs GPU) vs OpenAI (paid, fast, no GPU)? Recommend: configurable, default to OpenAI `text-embedding-3-small` ($0.02/1M tokens).

2. **Simulation tick interval**: AI Town uses 1s. MC likely needs 5-10s for dashboard context. Configurable?

3. **Agent count scaling**: AI Town runs 25 agents. MC currently has 3-10. Design for up to 50?

4. **Reflection trigger threshold**: AI Town uses cumulative importance > 500. May need tuning for MC's conversation frequency.

5. **Conversation partner selection**: AI Town uses proximity. MC should use role compatibility + shared task context. Algorithm TBD.
