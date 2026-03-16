# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-15)

**Core value:** Transform MC from monitoring dashboard into the definitive open-source platform for orchestrating AI agent teams
**Current focus:** Phase 8 — Integration & Polish

## Current Position

Phase: 7 of 8 COMPLETE, moving to Phase 8
Plan: Phase 7 all 3 plans executed (2 waves)
Status: Phase 7 verified, ready to plan Phase 8
Last activity: 2026-03-15 — Phase 7 Auto-Scaling complete (commit a4e2a5d)

Progress: █████████░ 87%

## Performance Metrics

**Velocity:**
- Total plans completed: 28
- Average duration: ~4.4 min/plan (parallel execution)
- Total execution time: ~100 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 Foundation | 5/5 | ~25 min | ~5 min |
| 2 Spatial Visualization | 5/5 | ~20 min | ~4 min |
| 3 Workflow Engine | 4/4 | ~15 min | ~4 min |
| 4 Team Chat | 4/4 | ~20 min | ~5 min |
| 5 Debate/Consensus | 4/4 | ~10 min | ~2.5 min |
| 6 Persona Simulation | 3/3 | ~10 min | ~3.3 min |
| 7 Auto-Scaling | 3/3 | ~10 min | ~3.3 min |

**Recent Trend:**
- Last 5 plans: 07-03 ✓, 07-02 ✓, 07-01 ✓, 06-03 ✓, 06-02 ✓
- Trend: All passed first attempt

## Phase 1 Outcomes

### What was built
- **Store slices:** Monolithic 1,146-line store → 6 domain slices + types module (34-line index)
- **Canvas store:** Separate `useCanvasStore` for React Flow with `AgentNodeData extends Record<string, unknown>`
- **Typed EventBus:** 43-member `EventDataMap` discriminated union, `broadcast<T>()` generic
- **writeTransaction:** SQLite BEGIN IMMEDIATE / COMMIT / ROLLBACK helper in db.ts
- **Error boundaries:** `global-error.tsx` (inline styles) + `error.tsx` (Tailwind)
- **Dep cleanup:** Removed `reactflow`, added `@dagrejs/dagre`

### Quality gate
- **Tests:** 76 files, 885 tests, 0 failures
- **TypeScript:** 0 errors

## Phase 2 Outcomes

### What was built
- **Spatial API:** 3 routes (relationships CRUD, positions batch upsert)
- **Spatial components:** AgentNode, TeamGroupNode, RelationshipEdge, AnimatedEdge, node-types
- **Canvas panel:** SpatialCanvasPanel with dagre layout, SSE updates, detail sidebar
- **2 migrations:** agent_relationships, spatial_positions tables

### Quality gate
- **Tests:** 78 files, 896 tests, 0 failures
- **TypeScript:** 0 errors

## Phase 3 Outcomes

### What was built
- **3 migrations:** workflow_phases, workflow_runs, workflow_phase_runs tables
- **Workflow engine:** 6 functions (createRun, completePhase, advanceWorkflow, approvePhase, rejectPhase, getRunStatus)
- **7 API routes:** template phases CRUD, runs CRUD, advance/approve/reject transitions
- **Workflow panel:** Templates tab, active runs tab, phase progress bar, approval controls
- **Extended template CRUD:** POST accepts phases array, GET JOINs phases
- **22 unit tests + 26 E2E specs**

### Quality gate
- **Tests:** 79 files, 918 tests, 0 failures
- **TypeScript:** 0 errors

### Key corrections from plans
- Panels use same-origin cookie auth, not API key (apiKey removed from panel component)
- `unknown` type for output_artifact requires `!= null` guard in JSX (not truthy check)

## Phase 4 Outcomes

### What was built
- **2 migrations:** teams, team_members tables
- **Mention routing:** mention-router.ts with loop prevention (max 3 agent-to-agent turns)
- **Teams CRUD:** 2 API routes (teams, team members)
- **Chat UI:** API-driven @mention autocomplete, @mention highlighting in message bubbles
- **Extended mentions:** @all, @team:name, @human resolution with team expansion
- **Workflow fix:** Zod schema .passthrough() for phases field
- **22 E2E tests + 35 unit tests**

### Quality gate
- **Tests:** 81 unit files (953), 715 E2E (0 failures)
- **TypeScript:** 0 errors

### Key corrections from plans
- `createTestAgent` returns generated name, not override — use `body.agent.name`
- Zod `.object()` strips unknown fields — `.passthrough()` needed
- Regex trailing colon capture fixed with `.replace(/:+$/, '')`

## Phase 5 Outcomes

### What was built
- **4 migrations:** debates, debate_arguments, debate_votes, debate_participants tables
- **Debate engine:** 6 functions (createDebate, submitArgument, advanceDebatePhase, castVote, getDebateStatus, concludeDebate)
- **7 API routes:** debates CRUD, arguments, advance, vote, results + updated /debates/start
- **Debate panel:** List with status filters, new debate form, detail view with argument tree and vote tally
- **State machine:** pending → propose → critique → rebut → vote → concluded/budget_exhausted
- **Token budget enforcement:** estimateTokens(text/4), budget_exhausted terminal state
- **30 unit + 37 API + 17 E2E tests**

### Quality gate
- **Tests:** 83 unit files (1037), 732 E2E (0 failures)
- **TypeScript:** 0 errors

## Phase 6 Outcomes

### What was built
- **PAD emotional model:** pleasure/arousal/dominance with exponential decay toward Big Five baseline (30min half-life)
- **8 cognitive biases:** trait-based activation thresholds (Confirmation, Anchoring, Availability, Sunk Cost, Bandwagon, Dunning-Kruger, Status Quo, Recency)
- **Pairwise trust:** agent_pairwise_trust migration, CRUD functions, trust network query
- **Drift prevention:** measureDrift (Euclidean distance), shouldReinjectPersona (every N turns), buildReinjectablePrompt
- **Persona API:** GET/PUT /api/agents/[id]/persona (OCEAN traits, PAD, presets, biases, trust network)
- **PersonaTab UI:** OCEAN sliders, preset selector, PAD sliders with emotion label, bias display, trust bars
- **buildSystemPrompt extended:** PAD section + cognitive biases section
- **56 unit tests + 10 E2E specs**

### Quality gate
- **Tests:** 83 unit files (1074), 742 E2E (0 failures)
- **TypeScript:** 0 errors

## Phase 7 Outcomes

### What was built
- **2 migrations:** scaling_policies table (thresholds, cooldown, idle_timeout, auto_approve, template) + scaling_events table (event_type, status, reason, metrics_snapshot)
- **Scaling engine:** 6 functions — lazy evaluation (no setInterval), cooldown enforcement, global agent cap, template-based spawning
- **9 API routes:** policies CRUD (5), evaluate with auto-approve, events list + approve/reject (3)
- **Scaling panel:** 3-tab dashboard (overview metrics, policies CRUD + evaluate, events with approve/reject)
- **87 unit tests + 11 E2E specs**

### Quality gate
- **Tests:** 85 unit files (1161), 753 E2E (0 failures)
- **TypeScript:** 0 errors

### Key corrections
- Zod `.default(false)` bypasses `.transform()` output type — use `.default(0)` for boolean→integer transforms
- SQL-fragment-matching mock pattern (createMockDb + _when) replaces fragile sequential mockReturnValueOnce

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Zustand store split into domain slices (not monolithic) — prevents re-render storms
- Separate `useCanvasStore` for React Flow — isolates 60fps drag updates
- SQLite `busy_timeout(5000)` + `BEGIN IMMEDIATE` — prevents SQLITE_BUSY
- EventBus-driven cross-system communication — no direct imports between systems
- Lazy evaluation with cooldown for auto-scaler — no setInterval (serverless safe)
- `ServerEvent.data` is `Record<string, unknown>` not `unknown` — allows property access without cast
- `AgentNodeData extends Record<string, unknown>` — satisfies @xyflow/react Node generic
- Panels use cookie auth (same-origin), E2E tests use x-api-key header
- Workflow engine uses writeTransaction for all mutations + EventBus broadcasts
- Debate engine separate from conversation-engine — structured protocol vs round-robin LLM
- Debate DELETE cascades manually (not FK CASCADE) for explicit control
- PAD state stored in agents.config JSON (no new table), pairwise trust in new table
- EventBus broadcast on PAD state changes (individual fields, not nested object)
- PersonaTab in agent detail modal (not separate panel)
- Scaling policy manual cascade delete (consistent with debate pattern)
- Auto-approve picks oldest idle agent (ORDER BY updated_at ASC)

### Pending Todos

None yet.

### Blockers/Concerns

- 6 uncommitted modified files from previous upstream sync session (CLAUDE.md, playwright.config.ts, src/lib/auth.ts, 4 E2E test specs) — not part of phases, need separate commit

## Session Continuity

Last session: 2026-03-15
Stopped at: Phase 7 complete, ready to plan Phase 8
Resume file: None
