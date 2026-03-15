# Project Research Summary

**Project:** Mission Control Agent Orchestration Platform
**Domain:** AI multi-agent orchestration platform (brownfield extension)
**Researched:** 2026-03-15
**Confidence:** MEDIUM-HIGH

## Executive Summary

Mission Control is remarkably well-positioned for this extension. The existing codebase already contains foundational engines for 5 of the 6 planned features — SOP engine (~70% of workflow), conversation engine (~50% of debate), persona engine (~60% of personas), simulation engine (~30% of auto-scaling), and topology panel (~30% of spatial viz). The primary work is *extending* proven code, not building from scratch.

The recommended approach is a phased rollout starting with a **foundation phase** that addresses existing tech debt (monolithic Zustand store, mega-components, missing error boundaries) before layering new features. Research from 7 reference platforms (MetaGPT, ChatDev, TinyTroupe, AI Town, AutoGen, CrewAI, LangGraph) confirms that the biggest risks in multi-agent platforms are not implementation difficulty but **coordination failures** (17x error amplification), **cost explosions** ($47K in one documented case), and **performance degradation** (Zustand re-render storms, SQLite write contention, SSE connection exhaustion). All three are preventable with proper architecture.

Only **1 new npm dependency** is needed (`@dagrejs/dagre` for graph auto-layout), with **1 legacy dependency to remove** (`reactflow` — superseded by the already-installed `@xyflow/react`). Net dependency change: **-1**. Total new SQLite tables: **7-14** (depending on normalization choices). Total new API routes: **~29**. Total new panels: **6**.

## Key Findings

### Recommended Stack

The project needs almost nothing new. The existing stack (Next.js 16, React 19, TypeScript 5.7, SQLite, Zustand 5, @xyflow/react, Zod) covers all 6 features. Key additions:

**New dependency (only 1):**
- `@dagrejs/dagre` ^2.0.4 — Auto-layout for directed graph nodes in spatial canvas. Synchronous, 26KB, recommended by React Flow docs.

**Remove (1):**
- `reactflow` ^11.11.4 — Legacy duplicate of `@xyflow/react` ^12.10.0 already installed.

**Core technologies reused:**
- `@xyflow/react` — Spatial canvas + workflow DAG visualization
- `Zustand 5` — Canvas state (separate store), feature state (slices in main store)
- `Zod 4.3.6` — Artifact schemas, debate configs, workflow template validation
- `better-sqlite3` — All new tables via migration system
- `EventBus` — All cross-system communication via typed events

### Expected Features

Based on analysis of 7 competitor platforms:

**Must have (table stakes):**
- Agent topology view with interactive nodes and edges (every orchestration tool has this)
- Sequential workflow definition with phase tracking (MetaGPT/CrewAI/LangGraph standard)
- @mention agent routing in shared chat (OpenClaw, AutoGen GroupChat pattern)
- Agent personality configuration (basic OCEAN traits — all persona platforms support this)

**Should have (competitive advantage):**
- Animated message flow on spatial canvas (no competitor has this in a web dashboard)
- Structured debate with voting (AutoGen has this; most don't)
- Human-in-the-loop approval gates in workflows (CrewAI Enterprise only)
- Template-based agent spawning with scaling policies

**Defer (v2+):**
- Auto-hiring/self-scaling — most experimental, highest risk, no open-source precedent
- 3D visualization — no operational value, massive complexity
- Drag-and-drop workflow builder — high UI complexity, form-based sufficient for MVP
- Confidence-weighted voting — requires mature persona system
- Conditional/parallel workflow branches — sequential sufficient for MVP

### Architecture Approach

Integration follows 4 key patterns discovered in research:

1. **EventBus-driven side effects** — Cross-system communication via typed events. No direct imports between systems. Workflow → spatial → auto-scaler → chat all communicate via EventBus.

2. **Lazy evaluation with cooldown** — No `setInterval` for periodic checks (leaks in serverless). Auto-scaler evaluates on request access with cooldown.

3. **Conversation namespacing** — Debate messages stored in existing `messages` table with `conversation_id = "debate:{id}"`. Reuses SSE events and chat UI automatically.

4. **Separate Zustand store for high-frequency state** — React Flow canvas state in `useCanvasStore` (60fps drag updates), everything else in main store. Prevents re-render cascading.

**Major components:**
1. `spatial-engine.ts` — Layout computation, dagre integration, SSE-driven node updates
2. `workflow-engine.ts` — SOP state machine extending existing `sop-engine.ts`
3. `debate-engine.ts` — Round management, vote tallying, consensus detection
4. `persona-engine.ts` — Extended with PAD emotional model, cognitive biases, trust scores
5. `scaling-engine.ts` — Queue depth evaluation, hire protocol, template-based spawning
6. `mention-router.ts` — @mention parsing → agent forwarding (thin layer on existing `mentions.ts`)

### Critical Pitfalls

Top 5 from PITFALLS.md (backed by peer-reviewed research):

1. **17x Error Amplification** — Small errors compound across agents exponentially. 41-86.7% of multi-agent systems fail in production. Prevention: typed schemas at every agent boundary, centralized orchestrator, cap at 4 structured agents. (Phase: Foundation)

2. **Cost Explosion in Debates** — N agents × M rounds × context growth = exponential token costs. $47K documented in one uncontrolled case. Prevention: hard per-session token budgets, round limits, sliding context window, S2-MAD redundancy filtering (94.5% token reduction). (Phase: Debate Rooms)

3. **Zustand Re-render Storms** — Monolithic 1,146-line store causes all 33+ panels to re-evaluate on any state change. With React Flow adding 60fps updates, this becomes catastrophic. Prevention: split store into domain slices, separate canvas store, atomic selectors, `useShallow`. (Phase: Foundation)

4. **SQLite Write Contention** — Single-writer with WAL. Workflow transitions + debate arguments + chat messages all competing for write lock. Prevention: `busy_timeout = 5000`, `BEGIN IMMEDIATE`, write batching via transactions, lazy eviction over `setInterval`. (Phase: Foundation)

5. **Runaway Agent Spawning** — Without depth limits and global caps, auto-scaling can create agent fork bombs. Prevention: global cap (20 agents), spawn rate limit (1/5s), depth limit (3 levels), mandatory human approval, budget gate. (Phase: Auto-Scaling)

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 0: Foundation & Tech Debt
**Rationale:** Research unanimously warns that layering complex features on a fragile foundation amplifies all risks. The monolithic Zustand store, mega-components, and missing error boundary must be addressed first.
**Delivers:** Split Zustand store into domain slices, add `global-error.tsx`, implement write queue for SQLite, add `busy_timeout`, reduce `any` count in integration points. Baseline performance metrics.
**Addresses:** P1 (error amplification), P3 (re-render storms), P4 (write contention), P10 (mega-component debt)
**Avoids:** Every pitfall — foundation quality prevents cascading failures

### Phase 1: Spatial 2D Visualization
**Rationale:** Highest user value, lowest risk. Builds on existing topology-panel.tsx and @xyflow/react. Independent of all other new features. Validates React Flow + Zustand integration pattern used by later phases (workflow DAG visualization).
**Delivers:** Interactive agent canvas with custom nodes (status badges), relationship edges, dagre auto-layout, click-to-detail, SSE-driven real-time updates, separate `useCanvasStore`.
**Uses:** `@xyflow/react` ^12.10.0, `@dagrejs/dagre` (new), existing EventBus
**Addresses:** Table stakes — agent topology view
**Avoids:** P9 (React Flow memory leaks via centralized SSE, viewport culling)

### Phase 2: Structured Workflow Engine
**Rationale:** Second highest value. Extends existing `sop-engine.ts` (~70% coverage). Validates the EventBus-driven pattern for phase transitions. Creates the task→workflow link that auto-scaling depends on.
**Delivers:** SOP template CRUD, sequential phase execution, artifact schema validation (Zod), manual artifact passing, phase status tracking, SSE events for phase transitions.
**Uses:** Existing `sop-engine.ts`, Zod, SQLite migrations
**Implements:** Workflow engine architecture from ARCHITECTURE.md
**Avoids:** P4 (write contention via transaction batching for phase transitions)

### Phase 3: @Mention Team Chat
**Rationale:** Low complexity, high value, independent. Extends existing Hermes chat with parsing + routing. Establishes the shared human-agent timeline that debate rooms depend on.
**Delivers:** @agent_name parsing via regex, agent auto-response routing, @all broadcast, team grouping (teams + team_members tables), autocomplete UI.
**Uses:** Existing `mentions.ts` (parseMentions/resolveMentionRecipients), existing chat messages API
**Avoids:** P8 (chat message loops via per-thread turn limit + cooldown)

### Phase 4: Debate/Consensus Rooms
**Rationale:** Depends on chat system (Phase 3) for message routing. Uses persona system for prompt construction. Higher complexity but well-researched (AutoGen solver/aggregator pattern).
**Delivers:** Create debate session, structured rounds (propose→critique→rebut→vote), majority voting, argument tree view, token budget enforcement, consensus detection.
**Uses:** Existing `conversation-engine.ts`, `messages` table (namespaced), LLM router
**Implements:** AutoGen debate pattern from FEATURES.md
**Avoids:** P5 (cost explosion via hard token budgets + round limits + sliding window)

### Phase 5: Deep Persona Simulation
**Rationale:** Multiplies value of debate rooms (Phase 4) and chat (Phase 3). Extends existing persona-engine.ts (~60% coverage). TinyTroupe reference architecture is well-documented.
**Delivers:** OCEAN traits editor (5-point discrete scale, not floats), PAD emotional model (pleasure/arousal/dominance), cognitive bias catalog (8 biases with activation functions), trust scores between agent pairs, prompt injection at LLM call time, emotional decay toward baseline.
**Uses:** Existing `persona-engine.ts`, existing agent CRUD
**Implements:** TinyTroupe persona model adapted for TypeScript
**Avoids:** P6 (persona drift via discrete levels, re-injection every 5 turns, consistency monitoring)

### Phase 6: Auto-Hiring/Self-Scaling
**Rationale:** Most complex, most experimental. Depends on workflow engine (Phase 2) for bottleneck detection and agent templates for spawning. No open-source precedent for dashboard-based auto-scaling. Should be last.
**Delivers:** Scaling policies (min/max agents, thresholds, cooldown), queue depth evaluation (lazy, not interval-based), hire request protocol via EventBus, template-based spawning, human approval gate, scale-down via idle detection, scaling event log.
**Uses:** Existing workload API, agent templates, simulation engine
**Avoids:** P7 (runaway spawning via global cap + depth limit + approval gate + budget check)

### Phase 7: Integration & Polish
**Rationale:** Cross-system integration, animated message flow on spatial canvas, workflow graph overlay on canvas, debate visualization on canvas, trust edges on spatial view. E2E testing of all 6 features together.
**Delivers:** Cross-feature SSE event wiring, animated edges, integration E2E specs, performance benchmarks (50+ nodes, 10-phase workflows, 5-agent debates).
**Addresses:** Success criteria validation from PROJECT.md

### Phase Ordering Rationale

- **Foundation first** because research shows 17x error amplification makes debugging impossible without clean boundaries
- **Spatial viz second** because it validates React Flow + Zustand + SSE integration pattern used by later phases (workflow DAG viz, debate participant display, trust edge visualization)
- **Workflow before debate** because workflow engine creates task→agent→phase relationships that debate rooms reference
- **Chat before debate** because debate messages route through chat infrastructure
- **Persona after debate** because persona value is realized through debate (argument style) and chat (response tone) — building persona first would lack demonstration contexts
- **Auto-scaling last** because it has the highest risk (runaway costs), depends on workflow maturity for bottleneck detection, and no open-source precedent exists

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4 (Debate):** Complex protocol design. Research the AutoGen solver/aggregator pattern + S2-MAD token reduction in detail before planning.
- **Phase 5 (Persona):** TinyTroupe's emotional model needs careful adaptation from Python to TypeScript. Research PAD (Pleasure/Arousal/Dominance) emotional space mapping.
- **Phase 6 (Auto-Scaling):** No open-source dashboard precedent. Research KEDA (Kubernetes auto-scaling) and Amazon SQS scaling formulas for threshold math.

Phases with standard patterns (skip research-phase):
- **Phase 0 (Foundation):** Zustand store splitting and error boundaries are well-documented patterns.
- **Phase 1 (Spatial):** React Flow documentation has complete examples for custom nodes, dagre layout, and Zustand integration.
- **Phase 3 (Chat):** @mention parsing is a solved problem. Existing `mentions.ts` already does most of the work.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm/GitHub. Only 1 new dep needed. Existing engines confirmed by codebase analysis. |
| Features | MEDIUM-HIGH | 7 competitor platforms analyzed. Feature landscape well-understood. Anti-features identified (3D viz, autonomous spawning). |
| Architecture | MEDIUM | Patterns verified against existing MC code structure. Data flows designed but untested. Migration numbering may need adjustment. |
| Pitfalls | HIGH | 7 peer-reviewed papers, 8 post-mortems, 33 total sources. Compound risks (SSE + SQLite + scaling) are MC-specific and well-analyzed. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

1. **Migration numbering conflict** — STACK.md counts 7 new tables, ARCHITECTURE.md counts 14. The difference is normalization granularity (e.g., workflow needs 3 tables: templates, runs, steps vs. 1 table). Resolution: during phase planning, finalize exact schema per feature.

2. **Existing engine API surface** — Research identified existing engines at 30-70% coverage but didn't audit every method. During phase planning, read each engine file completely to identify exact extension points.

3. **React Flow + SSE performance at scale** — No verified benchmark for 50+ nodes with real-time SSE updates through Zustand. Need load testing during Phase 1 implementation.

4. **Debate cost modeling** — S2-MAD claims 94.5% token reduction but is research-only (no production library). May need to implement custom token budgeting instead of relying on academic approaches.

5. **Auto-scaling threshold math** — Exact formula for desired_agents = f(queue_depth, agent_saturation, error_rate) needs tuning with real data. Conservative defaults + observability first.

## Sources

### Primary (HIGH confidence)
- [MetaGPT GitHub](https://github.com/FoundationAgents/MetaGPT) — SOP pipeline, publish-subscribe, role-action system
- [TinyTroupe GitHub](https://github.com/microsoft/TinyTroupe) — Big Five traits, cognitive state, episodic memory
- [ChatDev GitHub](https://github.com/OpenBMB/ChatDev) — Chat chain architecture, communicative dehallucination
- [AI Town GitHub](https://github.com/a16z-infra/ai-town) — Spatial world model, game loop, conversation system
- [React Flow Docs](https://reactflow.dev/) — Custom nodes, dagre layout, Zustand integration, performance guide
- [MAST Taxonomy (arXiv)](https://arxiv.org/abs/2503.13657) — 14 multi-agent failure modes across 1,642 traces
- [SQLite WAL Mode](https://sqlite.org/wal.html) — Concurrency characteristics

### Secondary (MEDIUM confidence)
- [AutoGen Multi-Agent Debate](https://microsoft.github.io/autogen/stable//user-guide/core-user-guide/design-patterns/multi-agent-debate.html) — Solver/aggregator pattern
- [S2-MAD (NAACL 2025)](https://aclanthology.org/2025.naacl-long.475.pdf) — 94.5% token reduction in debates
- [Persona Drift Study](https://arxiv.org/html/2402.10962v1) — 30%+ consistency degradation after 8-12 turns
- [CrewAI Hierarchical Process](https://docs.crewai.com/en/learn/hierarchical-process) — Manager delegation pattern
- [KEDA](https://keda.sh/) — Event-driven autoscaling reference architecture

### Tertiary (LOW confidence)
- [Debate Cost Post-Mortem](https://dev.to/askpatrick/rate-limiting-your-own-ai-agent-the-runaway-loop-problem-nobody-talks-about-3dh2) — $47K from uncontrolled agent loops
- [MAD Scaling Challenges (ICLR 2025)](https://d2jud02ci9yv69.cloudfront.net/2025-04-28-mad-159/blog/mad/) — MAD underperforms single-agent baselines (needs validation)

---
*Research completed: 2026-03-15*
*Ready for roadmap: yes*
