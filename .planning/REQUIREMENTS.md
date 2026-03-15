# Requirements: Mission Control Agent Orchestration Platform

**Defined:** 2026-03-15
**Core Value:** Transform MC from monitoring dashboard into the definitive open-source platform for orchestrating AI agent teams — enabling complex multi-agent workflows with spatial visualization, structured deliberation, deep persona simulation, self-scaling, and human-in-the-loop oversight.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation

- [ ] **FNDN-01**: Zustand store split into domain-specific slices (agents, tasks, workflows, debates, canvas) with no cross-slice re-render cascading
- [ ] **FNDN-02**: Global error boundary (`global-error.tsx`) catches root layout errors and displays recovery UI with `<html>` and `<body>` tags
- [ ] **FNDN-03**: SQLite write operations use `busy_timeout(5000)` and `BEGIN IMMEDIATE` to prevent SQLITE_BUSY under concurrent agent writes
- [ ] **FNDN-04**: Separate `useCanvasStore` (Zustand) for React Flow state, isolated from main application store
- [ ] **FNDN-05**: Legacy `reactflow` package removed, `@xyflow/react` is sole spatial library
- [ ] **FNDN-06**: `@dagrejs/dagre` installed for directed graph auto-layout
- [ ] **FNDN-07**: EventBus extended with typed events for all 6 new systems (spatial, workflow, debate, persona, scaling, chat mention)

### Spatial Visualization

- [ ] **SPAT-01**: Interactive @xyflow/react canvas renders agent nodes with name and status badge (online/offline/busy/error)
- [ ] **SPAT-02**: Relationship edges connect agents showing delegation, communication, and supervision links
- [ ] **SPAT-03**: dagre auto-layout positions agents in hierarchical topology without manual placement
- [ ] **SPAT-04**: User can drag nodes to reposition agents; positions persist across page refresh
- [ ] **SPAT-05**: Click on agent node opens agent detail panel with full agent information
- [ ] **SPAT-06**: SSE events drive real-time node status updates (agent created/updated/deleted reflected on canvas within 1 second)
- [ ] **SPAT-07**: Canvas supports zoom, pan, minimap, and background grid controls
- [ ] **SPAT-08**: Animated message flow along edges shows real-time inter-agent communication as moving particles
- [ ] **SPAT-09**: Team topology groups agents visually with labeled container nodes
- [ ] **SPAT-10**: Canvas renders 50+ agent nodes without frame drops below 30fps

### Workflow Engine

- [ ] **WKFL-01**: User can create SOP workflow templates with named phases in sequential order
- [ ] **WKFL-02**: Each workflow phase has assignable agent role, input schema, and output schema (Zod-validated)
- [ ] **WKFL-03**: User can start a workflow run from a template, producing an execution instance with status tracking
- [ ] **WKFL-04**: Workflow engine advances phases sequentially: current phase completes → next phase starts automatically
- [ ] **WKFL-05**: Phase transitions validate output artifacts against schema; reject transition on validation failure
- [ ] **WKFL-06**: Each phase creates tasks in the existing task board, linking workflow phases to task lifecycle
- [ ] **WKFL-07**: Workflow run status visible in dashboard: pending, running (with current phase), completed, failed
- [ ] **WKFL-08**: SSE events broadcast workflow phase transitions for real-time UI updates
- [ ] **WKFL-09**: User can configure per-phase human approval gates that pause workflow until admin approves
- [ ] **WKFL-10**: Workflow engine handles 10-phase SOPs with artifact validation between each phase

### Team Chat (@Mention)

- [ ] **CHAT-01**: Messages containing `@agent_name` route to the named agent for auto-response
- [ ] **CHAT-02**: `@all` broadcasts message to every active agent in workspace
- [ ] **CHAT-03**: `@team:name` routes message to all members of the named team
- [ ] **CHAT-04**: Agent auto-responds in the same channel thread within 5 seconds of being mentioned
- [ ] **CHAT-05**: Teams can be created and managed (CRUD) with agent membership
- [ ] **CHAT-06**: Chat input provides @mention autocomplete showing available agents and teams
- [ ] **CHAT-07**: Human and agent messages appear in a shared timeline (same channel, same thread)
- [ ] **CHAT-08**: Per-thread turn limit prevents @mention routing loops (max 3 agent-to-agent exchanges without human intervention)
- [ ] **CHAT-09**: @human routes message to operator notification (no agent forwarding)

### Debate/Consensus Rooms

- [ ] **DEBT-01**: User can create a debate session with topic, participant agents, and max rounds
- [ ] **DEBT-02**: Debate follows structured phases: propose → critique → rebut → vote
- [ ] **DEBT-03**: Each participant agent submits one argument per round, stored with confidence score
- [ ] **DEBT-04**: Voting round tallies agent votes (accept/reject) with majority determining outcome
- [ ] **DEBT-05**: Debate session auto-closes when consensus threshold is met or max rounds exhausted
- [ ] **DEBT-06**: Debate argument tree viewable as threaded conversation (argument → responses)
- [ ] **DEBT-07**: Hard per-debate token budget enforced before each LLM call; debate pauses on budget exhaustion
- [ ] **DEBT-08**: SSE events broadcast debate round transitions and argument submissions in real-time
- [ ] **DEBT-09**: Debate results (decision, vote tally, argument summary) recorded and retrievable
- [ ] **DEBT-10**: Debate rooms support 5+ agent participants with structured rounds completing without deadlock

### Persona Simulation

- [ ] **PRSA-01**: Each agent has configurable OCEAN personality traits (Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism) on 5-point discrete scale
- [ ] **PRSA-02**: Persona traits injected into LLM system prompt at call time via `buildPersonaPrompt()` — not cached, always computed fresh
- [ ] **PRSA-03**: 4+ persona presets available (e.g., "analytical", "creative", "cautious", "collaborative") that pre-fill OCEAN scores
- [ ] **PRSA-04**: PAD emotional model (pleasure/arousal/dominance) tracks agent emotional state as structured floats
- [ ] **PRSA-05**: Emotional state decays toward Big Five baseline over time via exponential decay function
- [ ] **PRSA-06**: Cognitive bias catalog (8 biases: confirmation, anchoring, availability, sunk cost, bandwagon, Dunning-Kruger, status quo, recency) with trait-based activation
- [ ] **PRSA-07**: Pairwise trust scores between agent pairs stored in `agent_trust_scores` table, updated after each interaction
- [ ] **PRSA-08**: Persona editor panel in agent detail allows viewing and editing OCEAN traits, emotional state, and active biases
- [ ] **PRSA-09**: Persona re-injection every 5 turns prevents persona drift beyond 1 standard deviation over 20-turn conversations

### Auto-Scaling

- [ ] **SCAL-01**: Scaling policies define min/max agents, queue depth thresholds for scale-up/down, and cooldown periods
- [ ] **SCAL-02**: Auto-scaler evaluates queue depth lazily on request access (no setInterval) with configurable cooldown
- [ ] **SCAL-03**: When scale-up triggered, auto-scaler selects agent template matching highest-priority task type in queue
- [ ] **SCAL-04**: New agents spawned via existing `POST /api/agents` with template configuration
- [ ] **SCAL-05**: Human approval gate: scaling events require admin approval before agent spawn (configurable to auto-approve)
- [ ] **SCAL-06**: Scale-down detects idle agents (no tasks for configurable threshold) and gracefully retires them after completing current work
- [ ] **SCAL-07**: Global agent cap (configurable, default 20) prevents runaway spawning regardless of policy
- [ ] **SCAL-08**: Scaling event log records every scale-up/down decision with metrics snapshot, agent ID, and reason
- [ ] **SCAL-09**: Scaling monitor panel shows current pool size, idle/busy counts, pending tasks, and event history
- [ ] **SCAL-10**: Auto-scaler responds to overload within 30 seconds of threshold breach

### Quality & Testing

- [ ] **QUAL-01**: All new features have unit tests with >60% coverage (matching existing vitest threshold)
- [ ] **QUAL-02**: All new API routes have E2E specs (Playwright) covering CRUD lifecycle + error cases
- [ ] **QUAL-03**: Zero increase in TypeScript `any` usage — all new code uses proper types
- [ ] **QUAL-04**: No regression in existing 870 tests — all pass after every phase
- [ ] **QUAL-05**: Each feature has its own SQLite migration(s) via existing migration system
- [ ] **QUAL-06**: All new API routes follow existing pattern: `requireRole()` → `validateBody()` → `getDatabase()` → `NextResponse.json()`

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Workflow Engine (Advanced)

- **WKFL-V2-01**: Parallel phase execution (multiple phases running simultaneously with `Promise.allSettled`)
- **WKFL-V2-02**: Conditional branching expressions on phase transitions (if artifact.score > 0.8 → skip review phase)
- **WKFL-V2-03**: Drag-and-drop visual workflow builder on @xyflow/react canvas
- **WKFL-V2-04**: Workflow versioning (edit template without breaking running instances)

### Debate (Advanced)

- **DEBT-V2-01**: Confidence-weighted voting (agent confidence score multiplies vote weight)
- **DEBT-V2-02**: Judge agent role that evaluates arguments and provides rulings
- **DEBT-V2-03**: S2-MAD redundancy filtering for 94.5% token reduction in extended debates
- **DEBT-V2-04**: Debate-as-workflow-phase (embed debate round inside SOP workflow)

### Persona (Advanced)

- **PRSA-V2-01**: Memory-emotion coupling (emotional valence weights memory retrieval importance)
- **PRSA-V2-02**: Episodic-to-semantic memory consolidation (TinyTroupe-style abstraction)
- **PRSA-V2-03**: Trust graph visualization as edge weights on spatial canvas

### Auto-Scaling (Advanced)

- **SCAL-V2-01**: Fully autonomous scaling without human approval gate
- **SCAL-V2-02**: Predictive scaling (spawn agents before queue backs up based on historical patterns)
- **SCAL-V2-03**: Cost-aware scaling (factor LLM token budget into spawn decisions)
- **SCAL-V2-04**: Nested agent spawning (agents spawning sub-agents, depth-limited to 3 levels)

### Spatial (Advanced)

- **SPAT-V2-01**: Workflow DAG overlay on spatial canvas (show phase dependencies as edges)
- **SPAT-V2-02**: Trust score edges between agent pairs on spatial canvas
- **SPAT-V2-03**: Historical replay (scrub through time to see agent state evolution)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| 3D visualization (reagraph/WebGL) | No operational value over 2D; massive complexity; already installed but not needed |
| Full game-engine spatial world | Entertainment-oriented (AI Town uses PixiJS tilemap); operational dashboard needs interactive graph, not game engine |
| WebSocket additions | SSE + HTTP POST sufficient for all 6 features; keeps deployment simple |
| PostgreSQL migration | SQLite sufficient for single-server deployment; documented scaling path |
| Mobile app | Desktop-first dashboard; responsive design is future work |
| Custom LLM fine-tuning | Use existing provider APIs with prompt engineering |
| Video/audio channels | Text-based communication only |
| Autonomous agent spawning without any limits | Runaway cost risk ($47K documented); always requires caps + approval gates |
| Free-form unstructured agent conversation | Produces hallucinated circular dialogue (confirmed by ChatDev research) |
| Icon libraries | CLAUDE.md convention: raw text/emoji only |
| Tailwind CSS v4 upgrade | Project on v3; upgrading breaks unlayered CSS vs @layer utilities |
| npm/yarn | pnpm only per project convention |

## Traceability

Which phases cover which requirements. Updated by create-roadmap.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FNDN-01 | Phase 1: Foundation | Pending |
| FNDN-02 | Phase 1: Foundation | Pending |
| FNDN-03 | Phase 1: Foundation | Pending |
| FNDN-04 | Phase 1: Foundation | Pending |
| FNDN-05 | Phase 1: Foundation | Pending |
| FNDN-06 | Phase 1: Foundation | Pending |
| FNDN-07 | Phase 1: Foundation | Pending |
| SPAT-01 | Phase 2: Spatial Visualization | Pending |
| SPAT-02 | Phase 2: Spatial Visualization | Pending |
| SPAT-03 | Phase 2: Spatial Visualization | Pending |
| SPAT-04 | Phase 2: Spatial Visualization | Pending |
| SPAT-05 | Phase 2: Spatial Visualization | Pending |
| SPAT-06 | Phase 2: Spatial Visualization | Pending |
| SPAT-07 | Phase 2: Spatial Visualization | Pending |
| SPAT-08 | Phase 2: Spatial Visualization | Pending |
| SPAT-09 | Phase 2: Spatial Visualization | Pending |
| SPAT-10 | Phase 2: Spatial Visualization | Pending |
| WKFL-01 | Phase 3: Workflow Engine | Pending |
| WKFL-02 | Phase 3: Workflow Engine | Pending |
| WKFL-03 | Phase 3: Workflow Engine | Pending |
| WKFL-04 | Phase 3: Workflow Engine | Pending |
| WKFL-05 | Phase 3: Workflow Engine | Pending |
| WKFL-06 | Phase 3: Workflow Engine | Pending |
| WKFL-07 | Phase 3: Workflow Engine | Pending |
| WKFL-08 | Phase 3: Workflow Engine | Pending |
| WKFL-09 | Phase 3: Workflow Engine | Pending |
| WKFL-10 | Phase 3: Workflow Engine | Pending |
| CHAT-01 | Phase 4: Team Chat | Pending |
| CHAT-02 | Phase 4: Team Chat | Pending |
| CHAT-03 | Phase 4: Team Chat | Pending |
| CHAT-04 | Phase 4: Team Chat | Pending |
| CHAT-05 | Phase 4: Team Chat | Pending |
| CHAT-06 | Phase 4: Team Chat | Pending |
| CHAT-07 | Phase 4: Team Chat | Pending |
| CHAT-08 | Phase 4: Team Chat | Pending |
| CHAT-09 | Phase 4: Team Chat | Pending |
| DEBT-01 | Phase 5: Debate/Consensus | Pending |
| DEBT-02 | Phase 5: Debate/Consensus | Pending |
| DEBT-03 | Phase 5: Debate/Consensus | Pending |
| DEBT-04 | Phase 5: Debate/Consensus | Pending |
| DEBT-05 | Phase 5: Debate/Consensus | Pending |
| DEBT-06 | Phase 5: Debate/Consensus | Pending |
| DEBT-07 | Phase 5: Debate/Consensus | Pending |
| DEBT-08 | Phase 5: Debate/Consensus | Pending |
| DEBT-09 | Phase 5: Debate/Consensus | Pending |
| DEBT-10 | Phase 5: Debate/Consensus | Pending |
| PRSA-01 | Phase 6: Persona Simulation | Pending |
| PRSA-02 | Phase 6: Persona Simulation | Pending |
| PRSA-03 | Phase 6: Persona Simulation | Pending |
| PRSA-04 | Phase 6: Persona Simulation | Pending |
| PRSA-05 | Phase 6: Persona Simulation | Pending |
| PRSA-06 | Phase 6: Persona Simulation | Pending |
| PRSA-07 | Phase 6: Persona Simulation | Pending |
| PRSA-08 | Phase 6: Persona Simulation | Pending |
| PRSA-09 | Phase 6: Persona Simulation | Pending |
| SCAL-01 | Phase 7: Auto-Scaling | Pending |
| SCAL-02 | Phase 7: Auto-Scaling | Pending |
| SCAL-03 | Phase 7: Auto-Scaling | Pending |
| SCAL-04 | Phase 7: Auto-Scaling | Pending |
| SCAL-05 | Phase 7: Auto-Scaling | Pending |
| SCAL-06 | Phase 7: Auto-Scaling | Pending |
| SCAL-07 | Phase 7: Auto-Scaling | Pending |
| SCAL-08 | Phase 7: Auto-Scaling | Pending |
| SCAL-09 | Phase 7: Auto-Scaling | Pending |
| SCAL-10 | Phase 7: Auto-Scaling | Pending |
| QUAL-01 | Phase 8: Integration & Polish | Pending |
| QUAL-02 | Phase 8: Integration & Polish | Pending |
| QUAL-03 | Phase 8: Integration & Polish | Pending |
| QUAL-04 | Phase 8: Integration & Polish | Pending |
| QUAL-05 | Phase 8: Integration & Polish | Pending |
| QUAL-06 | Phase 8: Integration & Polish | Pending |

**Coverage:**
- v1 requirements: 71 total
- Mapped to phases: 71
- Unmapped: 0

---
*Requirements defined: 2026-03-15*
*Last updated: 2026-03-15 after roadmap creation*
