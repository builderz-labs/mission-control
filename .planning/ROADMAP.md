# Roadmap: Mission Control Agent Orchestration Platform

## Overview

Transform Mission Control from a monitoring dashboard into an AI agent orchestration platform across 8 phases. Starting with foundation hardening (store split, SQLite concurrency, error boundaries), then building spatial visualization, workflow engine, team chat, debate rooms, persona simulation, and auto-scaling — each phase extending proven existing infrastructure. Final phase integrates all 6 systems with cross-cutting quality validation.

## Phases

- [ ] **Phase 1: Foundation** - Split Zustand store, harden SQLite concurrency, add error boundaries, install dagre, extend EventBus
- [ ] **Phase 2: Spatial Visualization** - Interactive @xyflow/react canvas with agent nodes, relationship edges, dagre auto-layout, SSE-driven updates
- [ ] **Phase 3: Workflow Engine** - SOP templates with sequential phase execution, Zod artifact validation, human approval gates
- [ ] **Phase 4: Team Chat** - @mention routing (@agent, @all, @team), auto-response, team CRUD, autocomplete, loop prevention
- [ ] **Phase 5: Debate/Consensus** - Structured deliberation rooms with propose/critique/rebut/vote rounds, token budgets, argument trees
- [ ] **Phase 6: Persona Simulation** - OCEAN traits, PAD emotional model, cognitive biases, trust scores, persona drift prevention
- [ ] **Phase 7: Auto-Scaling** - Scaling policies, lazy queue evaluation, template-based spawning, human approval gate, global cap
- [ ] **Phase 8: Integration & Polish** - Cross-system SSE wiring, animated message flow, E2E validation, quality gate enforcement

## Phase Details

### Phase 1: Foundation
**Goal**: Clean architectural base that prevents cascading failures across all 6 new features
**Depends on**: Nothing (first phase)
**Requirements**: FNDN-01, FNDN-02, FNDN-03, FNDN-04, FNDN-05, FNDN-06, FNDN-07
**Success Criteria** (what must be TRUE):
  1. Zustand store split into domain slices — changing agent state does NOT re-render workflow/debate panels
  2. `global-error.tsx` catches root layout errors and displays recovery UI with `<html>` and `<body>` tags
  3. SQLite concurrent writes (3+ simultaneous) complete without SQLITE_BUSY errors
  4. `useCanvasStore` exists as separate Zustand store for React Flow state
  5. Legacy `reactflow` package removed, `@xyflow/react` is sole spatial library
**Research**: Unlikely (Zustand store splitting and error boundaries are well-documented patterns)
**Plans**: TBD

### Phase 2: Spatial Visualization
**Goal**: Interactive agent canvas with real-time status updates and hierarchical auto-layout
**Depends on**: Phase 1
**Requirements**: SPAT-01, SPAT-02, SPAT-03, SPAT-04, SPAT-05, SPAT-06, SPAT-07, SPAT-08, SPAT-09, SPAT-10
**Success Criteria** (what must be TRUE):
  1. Agent nodes render on canvas with name and status badge, updated in real-time via SSE
  2. Relationship edges show delegation, communication, and supervision links between agents
  3. Dagre auto-layout positions agents in hierarchical topology without manual placement
  4. User can drag nodes to reposition; positions persist across page refresh
  5. Canvas renders 50+ agent nodes without frame drops below 30fps
**Research**: Unlikely (React Flow documentation has complete examples for custom nodes, dagre layout, and Zustand integration)
**Plans**: TBD

### Phase 3: Workflow Engine
**Goal**: SOP templates with sequential phase execution, artifact validation, and human approval gates
**Depends on**: Phase 1
**Requirements**: WKFL-01, WKFL-02, WKFL-03, WKFL-04, WKFL-05, WKFL-06, WKFL-07, WKFL-08, WKFL-09, WKFL-10
**Success Criteria** (what must be TRUE):
  1. User can create SOP workflow template with named phases, assigned agent roles, and input/output schemas
  2. Workflow run advances phases sequentially — current phase completes, next phase starts automatically
  3. Phase transitions validate output artifacts against Zod schema; reject transition on validation failure
  4. Human approval gates pause workflow until admin approves
  5. 10-phase SOPs with artifact validation between each phase execute to completion
**Research**: Unlikely (extends existing sop-engine.ts with established state machine patterns)
**Plans**: TBD

### Phase 4: Team Chat
**Goal**: Human-agent shared chat with @mention routing, team addressing, and loop prevention
**Depends on**: Phase 1
**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07, CHAT-08, CHAT-09
**Success Criteria** (what must be TRUE):
  1. Messages containing `@agent_name` route to named agent and receive auto-response within 5 seconds
  2. `@all` broadcasts to every active agent; `@team:name` routes to team members
  3. Teams can be created and managed (CRUD) with agent membership
  4. Chat input provides @mention autocomplete showing available agents and teams
  5. Per-thread turn limit (max 3 agent-to-agent exchanges) prevents routing loops
**Research**: Unlikely (@mention parsing is a solved problem; existing mentions.ts already handles most of the work)
**Plans**: TBD

### Phase 5: Debate/Consensus
**Goal**: Structured multi-agent deliberation with voting, token budgets, and argument tree visualization
**Depends on**: Phase 4 (debate messages route through chat infrastructure)
**Requirements**: DEBT-01, DEBT-02, DEBT-03, DEBT-04, DEBT-05, DEBT-06, DEBT-07, DEBT-08, DEBT-09, DEBT-10
**Success Criteria** (what must be TRUE):
  1. User can create debate session with topic, participant agents, and max rounds
  2. Debate follows structured phases: propose, critique, rebut, vote — with majority determining outcome
  3. Hard per-debate token budget enforced before each LLM call; debate pauses on budget exhaustion
  4. Argument tree viewable as threaded conversation (argument, responses)
  5. 5+ agent participants complete structured rounds without deadlock
**Research**: Likely (complex protocol design)
**Research topics**: AutoGen solver/aggregator debate pattern, S2-MAD token reduction techniques, sliding context window implementation, deadlock prevention in multi-agent round-robin
**Plans**: TBD

### Phase 6: Persona Simulation
**Goal**: Deep personality modeling with emotional state, cognitive biases, and inter-agent trust dynamics
**Depends on**: Phase 1 (extends existing persona-engine.ts)
**Requirements**: PRSA-01, PRSA-02, PRSA-03, PRSA-04, PRSA-05, PRSA-06, PRSA-07, PRSA-08, PRSA-09
**Success Criteria** (what must be TRUE):
  1. Each agent has configurable OCEAN traits (5-point discrete scale) with 4+ persona presets
  2. PAD emotional model (pleasure/arousal/dominance) tracks agent emotional state with exponential decay toward baseline
  3. 8 cognitive biases activate based on trait-based thresholds
  4. Pairwise trust scores between agents update after each interaction
  5. Persona re-injection every 5 turns prevents drift beyond 1 standard deviation over 20-turn conversations
**Research**: Likely (emotional model adaptation)
**Research topics**: TinyTroupe Big Five → PAD mapping in TypeScript, emotional decay functions, cognitive bias activation formulas, persona drift measurement methodology
**Plans**: TBD

### Phase 7: Auto-Scaling
**Goal**: Template-based agent spawning with lazy queue evaluation, human approval, and global safety caps
**Depends on**: Phase 3 (workflow engine creates task queues that scaling monitors)
**Requirements**: SCAL-01, SCAL-02, SCAL-03, SCAL-04, SCAL-05, SCAL-06, SCAL-07, SCAL-08, SCAL-09, SCAL-10
**Success Criteria** (what must be TRUE):
  1. Scaling policies define min/max agents, queue depth thresholds, and cooldown periods
  2. Auto-scaler evaluates queue depth lazily on request access (no setInterval) and spawns matching agent template
  3. Human approval gate requires admin confirmation before agent spawn (configurable to auto-approve)
  4. Scale-down retires idle agents gracefully after completing current work
  5. Global agent cap (default 20) prevents runaway spawning; responds within 30 seconds of threshold breach
**Research**: Likely (no open-source precedent)
**Research topics**: KEDA event-driven autoscaling formulas, Amazon SQS scaling math for threshold tuning, idle detection heuristics, graceful agent retirement protocol
**Plans**: TBD

### Phase 8: Integration & Polish
**Goal**: Cross-system wiring, animated message flow on spatial canvas, and comprehensive quality validation
**Depends on**: Phases 2-7 (all features must exist before integration)
**Requirements**: QUAL-01, QUAL-02, QUAL-03, QUAL-04, QUAL-05, QUAL-06
**Success Criteria** (what must be TRUE):
  1. All 6 features have unit tests with >60% coverage and E2E specs covering CRUD lifecycle + error cases
  2. Zero increase in TypeScript `any` usage — all new code uses proper types
  3. No regression in existing 870 tests — all pass after integration
  4. All new API routes follow existing pattern: requireRole() → validateBody() → getDatabase() → NextResponse.json()
  5. Cross-system SSE events wire all 6 features together (workflow → spatial updates, debate → chat messages, scaling → spatial node additions)
**Research**: Unlikely (internal patterns and integration testing)
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8
Note: Phases 2, 3, 4, and 6 all depend only on Phase 1, enabling parallel planning.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/TBD | Not started | - |
| 2. Spatial Visualization | 0/TBD | Not started | - |
| 3. Workflow Engine | 0/TBD | Not started | - |
| 4. Team Chat | 0/TBD | Not started | - |
| 5. Debate/Consensus | 0/TBD | Not started | - |
| 6. Persona Simulation | 0/TBD | Not started | - |
| 7. Auto-Scaling | 0/TBD | Not started | - |
| 8. Integration & Polish | 0/TBD | Not started | - |

---
*Roadmap created: 2026-03-15*
*Last updated: 2026-03-15 after initial creation*
