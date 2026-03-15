# Architecture Research: 6-System Integration into Mission Control

**Domain:** AI multi-agent orchestration platform
**Researched:** 2026-03-15
**Confidence:** MEDIUM (research-backed patterns applied to MC-specific constraints)

## System Overview

```
                         MISSION CONTROL — INTEGRATION MAP
                         =================================

 CLIENT (React 19 + Zustand 5)
 ============================================================================
 |  Existing Panels          |  NEW Panels                                  |
 |  +-----------------+      |  +------------------+  +------------------+  |
 |  | task-board      |      |  | spatial-canvas   |  | debate-room      |  |
 |  | agent-squad     |      |  | (React Flow)     |  | (deliberation)   |  |
 |  | chat-page       |      |  +------------------+  +------------------+  |
 |  | activity-feed   |      |  +------------------+  +------------------+  |
 |  | virtual-office  |      |  | workflow-runner  |  | persona-editor   |  |
 |  +-----------------+      |  | (SOP execution)  |  | (Big Five traits)|  |
 |                           |  +------------------+  +------------------+  |
 |                           |  +------------------+                        |
 |                           |  | scaling-monitor  |                        |
 |                           |  | (pool dashboard) |                        |
 |                           |  +------------------+                        |
 ============================================================================
         |  Zustand Store (single store, new slices)          |  SSE
         |  useMissionControl + useCanvasStore (new)          |  EventSource
         v                                                    v
 ============================================================================
 API LAYER (Next.js App Router)
 ============================================================================
 |  Existing Routes            |  NEW Route Groups                          |
 |  /api/agents/*              |  /api/spatial/*        (canvas state)      |
 |  /api/tasks/*               |  /api/workflows/*      (SOP engine)       |
 |  /api/chat/messages/*       |  /api/debates/*        (deliberation)     |
 |  /api/events (SSE)          |  /api/personas/*       (trait profiles)   |
 |  /api/mentions              |  /api/scaling/*        (auto-scale)       |
 |  /api/hermes/*              |  /api/events (SSE)     (extended types)   |
 ============================================================================
         |  requireRole() -> validateBody() -> getDatabase() -> NextResponse
         v
 ============================================================================
 BUSINESS LOGIC (src/lib/)
 ============================================================================
 |  Existing Modules             |  NEW Modules                             |
 |  event-bus.ts (EventBus)      |  spatial-engine.ts    (layout compute)  |
 |  mentions.ts  (@mention)      |  workflow-engine.ts   (SOP state machine)|
 |  agent-templates.ts           |  debate-engine.ts     (round mgmt)     |
 |  db.ts, auth.ts               |  persona-engine.ts    (trait -> prompt) |
 |  injection-guard.ts           |  scaling-engine.ts    (pool scaling)    |
 |  coordinator-routing.ts       |  mention-router.ts    (@ -> forwarding) |
 ============================================================================
         |  eventBus.broadcast()                     |
         v                                           v
 ============================================================================
 DATA LAYER (SQLite + better-sqlite3, WAL mode)
 ============================================================================
 |  Existing Tables               |  NEW Tables (via migrations.ts)        |
 |  agents, tasks, messages       |  spatial_layouts, spatial_edges        |
 |  users, activities             |  workflow_sops, workflow_phases        |
 |  workflow_templates            |  workflow_runs, workflow_run_steps     |
 |  quality_reviews               |  debate_sessions, debate_rounds       |
 |  audit_log, webhooks           |  debate_votes, debate_arguments       |
 |  notifications                 |  persona_profiles, persona_states     |
 |                                |  scaling_policies, scaling_events     |
 |                                |  scaling_pool_snapshots               |
 ============================================================================
```

## Component Responsibilities

| Component | Responsibility | Integration Points |
|-----------|----------------|-------------------|
| **Spatial Canvas** | 2D visualization of agent topology, message flows, task pipelines | Zustand store, SSE events, agent CRUD, task board |
| **Workflow Engine** | SOP template CRUD, phase execution, artifact validation | Task board, agent assignment, EventBus, audit log |
| **Debate Rooms** | Structured deliberation with rounds, votes, consensus | Hermes chat, agent comms, LLM router, notifications |
| **Persona System** | Big Five traits, emotional state, cognitive bias modeling | Agent CRUD (soul_content), LLM prompt construction |
| **Auto-Scaling** | Queue depth monitoring, threshold-based agent spawning | EventBus, agent templates, task assignment, spawn API |
| **@Mention Router** | Parse @agent in chat, route to correct agent session | Existing mentions.ts, chat messages, coordinator routing |

---

## System 1: Spatial 2D Visualization

### Architecture

```
  +-------------------+     SSE /api/events      +-------------------+
  |  spatial-canvas   | <----------------------- |  EventBus         |
  |  -panel.tsx       |                          |  (server-side)    |
  |  (@xyflow/react)  |                          +-------------------+
  +-------------------+                                   ^
         |                                                |
         | Zustand: useCanvasStore                        | broadcast()
         v                                                |
  +-------------------+     REST CRUD             +-------------------+
  | useCanvasStore    | ---/api/spatial/layouts--> | spatial-engine.ts |
  | (separate store)  | ---/api/spatial/edges----> | (layout compute)  |
  +-------------------+                           +-------------------+
                                                          |
                                                          v
                                                  +-------------------+
                                                  | SQLite Tables     |
                                                  | spatial_layouts   |
                                                  | spatial_edges     |
                                                  +-------------------+
```

**Confidence:** HIGH -- React Flow + Zustand is the documented best practice from xyflow.

### Why a Separate Store

React Flow uses Zustand internally. Colocating canvas state (nodes, edges, viewport) in the
existing `useMissionControl` store would create excessive re-renders across unrelated panels.
A dedicated `useCanvasStore` keeps React Flow's high-frequency position updates isolated.

The existing `useMissionControl` store stays the source of truth for agents, tasks, and
sessions. The canvas store *derives* node data from `useMissionControl.agents` and
`useMissionControl.tasks` via Zustand's `subscribeWithSelector`.

### Custom Nodes

| Node Type | Data Source | Visual |
|-----------|------------|--------|
| `AgentNode` | `agents[]` from main store | Name, role, status indicator (color dot), task count badge |
| `TaskNode` | `tasks[]` from main store | Title, status pill, assigned agent |
| `MessageEdge` | SSE `chat.message` events | Animated dashed line, label with message preview |
| `WorkflowEdge` | `workflow_runs` | Solid line with phase progress indicator |

### SSE Integration Pattern

New EventBus types to add:

```typescript
// New event types for spatial system
| 'spatial.layout.updated'
| 'spatial.node.moved'
```

Client-side SSE handler in the canvas panel:

```typescript
// In spatial-canvas-panel.tsx
useEffect(() => {
  const es = new EventSource('/api/events')
  es.onmessage = (e) => {
    const event = JSON.parse(e.data)
    switch (event.type) {
      case 'agent.status_changed':
        // Update node appearance (color, animation) via useCanvasStore
        useCanvasStore.getState().updateNodeData(event.data.id, {
          status: event.data.status
        })
        break
      case 'chat.message':
        // Animate edge between sender/receiver nodes
        useCanvasStore.getState().flashEdge(
          event.data.from_agent,
          event.data.to_agent
        )
        break
      case 'task.status_changed':
        // Update task node if visible
        useCanvasStore.getState().updateNodeData(event.data.id, {
          status: event.data.status
        })
        break
    }
  }
  return () => es.close()
}, [])
```

### Data Model

```sql
-- Migration: 058_spatial_layouts
CREATE TABLE spatial_layouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  layout_data TEXT NOT NULL,  -- JSON: { nodes: Node[], edges: Edge[], viewport: Viewport }
  is_default INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  workspace_id INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_spatial_layouts_workspace ON spatial_layouts(workspace_id);

-- Persistent edge definitions (agent-to-agent relationships)
CREATE TABLE spatial_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_agent_id INTEGER NOT NULL,
  target_agent_id INTEGER NOT NULL,
  edge_type TEXT NOT NULL DEFAULT 'communication',  -- communication|delegation|supervision
  label TEXT,
  metadata TEXT,  -- JSON
  workspace_id INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (source_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (target_agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_spatial_edges_workspace ON spatial_edges(workspace_id);
CREATE INDEX idx_spatial_edges_source ON spatial_edges(source_agent_id);
CREATE INDEX idx_spatial_edges_target ON spatial_edges(target_agent_id);
```

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/spatial/layouts` | GET, POST | List/create layouts |
| `/api/spatial/layouts/[id]` | GET, PUT, DELETE | CRUD single layout |
| `/api/spatial/edges` | GET, POST | List/create persistent edges |
| `/api/spatial/edges/[id]` | PUT, DELETE | Update/delete edge |
| `/api/spatial/auto-layout` | POST | Compute auto-layout (dagre/elk algorithm) |

---

## System 2: Structured Workflow Engine (SOP)

### Architecture

```
  +-------------------+                           +-------------------+
  | workflow-runner   |     REST CRUD              | workflow-engine   |
  | -panel.tsx        | ---/api/workflows/sops---> | .ts               |
  | (SOP dashboard)   | ---/api/workflows/runs---> | (state machine)   |
  +-------------------+                           +-------------------+
         |                                                |
         | SSE: workflow.phase.completed                   | eventBus.broadcast()
         | SSE: workflow.run.status_changed                | agent assignment
         v                                                v
  +-------------------+                           +-------------------+
  | useMissionControl | <-- tasks[], agents[] --> | Task Board        |
  | (existing store)  |                           | (existing panel)  |
  +-------------------+                           +-------------------+
```

**Confidence:** HIGH -- State machine pattern is well-established for SOP execution (MetaGPT, LangGraph).

### State Machine vs DAG

**Decision: State Machine with sequential phases, parallel steps within phases.**

Rationale:
- SOPs are inherently sequential (Phase 1 must complete before Phase 2)
- Within a phase, multiple agents can work in parallel on different artifacts
- A full DAG engine adds complexity without clear benefit for SOP-style workflows
- The existing `workflow_templates` table (migration 006) already stores single-step templates;
  the new system extends this to multi-phase SOPs

### SOP Structure

```
SOP Template
  |-- Phase 1: "Requirements Gathering"
  |     |-- Step 1.1: Agent=Analyst, Artifact=PRD.md (schema: markdown)
  |     |-- Step 1.2: Agent=Researcher, Artifact=competitive_analysis.json (schema: JSON)
  |-- Phase 2: "Architecture Design"
  |     |-- Step 2.1: Agent=Architect, Artifact=design_doc.md
  |     |-- Gate: PRD approved by reviewer
  |-- Phase 3: "Implementation"
  |     |-- Step 3.1: Agent=Engineer, Artifact=code changes
  |     |-- Step 3.2: Agent=Engineer, Artifact=tests
  |-- Phase 4: "Quality Review"
        |-- Step 4.1: Agent=QA, Artifact=test_report.json
```

### Workflow Run Lifecycle

```
                  +-----------+
                  |  CREATED  |
                  +-----+-----+
                        |
                  +-----v-----+
             +--->|  RUNNING   |<---+
             |    +-----+-----+    |
             |          |          |
       (retry)    +-----v-----+   | (next phase)
             |    |  PHASE_N   |---+
             |    +-----+-----+
             |          |
             |    +-----v-----+
             +----|  BLOCKED   | (gate not passed)
                  +-----+-----+
                        |
              +---------+---------+
              |                   |
        +-----v-----+     +------v----+
        | COMPLETED  |     |  FAILED   |
        +-----------+     +-----------+
```

### Data Model

```sql
-- Migration: 059_workflow_sops
CREATE TABLE workflow_sops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  phases TEXT NOT NULL,  -- JSON: WorkflowPhase[]
  tags TEXT,             -- JSON: string[]
  created_by TEXT NOT NULL,
  workspace_id INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_workflow_sops_workspace ON workflow_sops(workspace_id);

-- Phase definitions stored as JSON in workflow_sops.phases:
-- {
--   "id": "phase-1",
--   "name": "Requirements",
--   "order": 1,
--   "steps": [
--     {
--       "id": "step-1-1",
--       "agent_role": "analyst",
--       "artifact_name": "prd.md",
--       "artifact_schema": { "type": "markdown", "required_sections": ["Goals", "Scope"] },
--       "timeout_seconds": 600,
--       "prompt_template": "Analyze the following requirement: {{input}}"
--     }
--   ],
--   "gate": {
--     "type": "approval",        -- approval | artifact_valid | auto
--     "approver_role": "admin"
--   }
-- }

CREATE TABLE workflow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sop_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',  -- created|running|blocked|completed|failed|cancelled
  current_phase TEXT,
  input_data TEXT,    -- JSON: initial input to the workflow
  output_data TEXT,   -- JSON: final aggregated output
  started_by TEXT NOT NULL,
  workspace_id INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (sop_id) REFERENCES workflow_sops(id) ON DELETE CASCADE
);

CREATE INDEX idx_workflow_runs_workspace ON workflow_runs(workspace_id);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);

CREATE TABLE workflow_run_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  phase_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  assigned_agent TEXT,
  task_id INTEGER,           -- FK to tasks table (creates real task)
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|running|completed|failed|skipped
  artifact_data TEXT,        -- JSON: produced artifact
  error_message TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX idx_workflow_run_steps_run ON workflow_run_steps(run_id);
CREATE INDEX idx_workflow_run_steps_status ON workflow_run_steps(status);
```

### Integration with Existing Task Board

When a workflow step starts, the engine creates a real `tasks` row via `db_helpers.logActivity()`.
The `workflow_run_steps.task_id` FK links back. This means:
- Task board shows workflow-generated tasks alongside manually created ones
- Agents see workflow tasks in their queue
- Task status changes trigger `task.status_changed` events that the workflow engine listens for

### New EventBus Types

```typescript
| 'workflow.run.created'
| 'workflow.run.status_changed'
| 'workflow.phase.started'
| 'workflow.phase.completed'
| 'workflow.step.completed'
```

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/workflows/sops` | GET, POST | List/create SOP templates |
| `/api/workflows/sops/[id]` | GET, PUT, DELETE | CRUD single SOP |
| `/api/workflows/runs` | GET, POST | List runs / start new run |
| `/api/workflows/runs/[id]` | GET, PUT | Get run detail / cancel run |
| `/api/workflows/runs/[id]/advance` | POST | Force-advance to next phase (admin) |
| `/api/workflows/runs/[id]/steps` | GET | List steps for a run |

---

## System 3: Debate/Consensus Rooms

### Architecture

```
  +-------------------+                           +-------------------+
  | debate-room       |     REST CRUD              | debate-engine.ts  |
  | -panel.tsx        | ---/api/debates/-------->  | (round manager)   |
  | (deliberation UI) |                           +-------------------+
  +-------------------+                                   |
         |                                                | Creates messages
         | SSE: debate.round.started                      | in existing
         | SSE: debate.vote.cast                          | messages table
         | SSE: debate.consensus.reached                  v
         v                                        +-------------------+
  +-------------------+                           | Hermes Chat       |
  | useMissionControl | <-- chatMessages[] -----> | (messages table)  |
  | (existing store)  |                           +-------------------+
  +-------------------+
```

**Confidence:** MEDIUM -- Debate architecture patterns are well-researched (2025 ACL findings), but
integration with existing Hermes chat adds complexity. The round-robin + voting pattern is proven,
but consensus threshold tuning will need experimentation.

### Debate Session Lifecycle

```
  CREATE SESSION (topic, participants[], config)
         |
         v
  +-----------+
  | ROUND 1   |  Each participant submits an argument
  |           |  (stored as messages in conversation_id = "debate:{session_id}")
  +-----------+
         |
         v
  +-----------+
  | ROUND 2   |  Participants respond to others' arguments
  |           |  (can agree/disagree/abstain)
  +-----------+
         |
         v
  +--- N rounds or consensus reached ---+
         |                               |
  +------v------+               +--------v-------+
  | VOTE PHASE  |               | AUTO-CONSENSUS |
  | (if voting  |               | (if agreement  |
  |  protocol)  |               |  threshold met)|
  +------+------+               +--------+-------+
         |                               |
         v                               v
  +-------------+               +--------------+
  | TALLY/RESULT|               | RESULT       |
  +-------------+               +--------------+
```

### Decision Protocol Selection

Based on 2025 ACL research ("Voting or Consensus? Decision-Making in Multi-Agent Debate"):
- **Voting** improves performance by 13.2% on reasoning tasks
- **Consensus** improves performance by 2.8% on knowledge tasks
- Recommendation: Make protocol configurable per debate session

### Data Model

```sql
-- Migration: 060_debate_sessions
CREATE TABLE debate_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'created',  -- created|active|voting|completed|cancelled
  protocol TEXT NOT NULL DEFAULT 'voting',  -- voting|consensus|hybrid
  max_rounds INTEGER NOT NULL DEFAULT 3,
  current_round INTEGER NOT NULL DEFAULT 0,
  consensus_threshold REAL NOT NULL DEFAULT 0.75,  -- 0.0-1.0, fraction needed for consensus
  conversation_id TEXT NOT NULL,  -- Links to messages table: "debate:{id}"
  config TEXT,  -- JSON: { timePerRound, allowAbstain, requireJustification }
  result TEXT,  -- JSON: { winner, votes, summary }
  created_by TEXT NOT NULL,
  workspace_id INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);

CREATE INDEX idx_debate_sessions_workspace ON debate_sessions(workspace_id);
CREATE INDEX idx_debate_sessions_status ON debate_sessions(status);

CREATE TABLE debate_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  round_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',  -- open|closed
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  closed_at INTEGER,
  FOREIGN KEY (session_id) REFERENCES debate_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_debate_rounds_session ON debate_rounds(session_id);

CREATE TABLE debate_arguments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  round_id INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  position TEXT NOT NULL,  -- 'for'|'against'|'neutral'|'alternative'
  content TEXT NOT NULL,
  references_argument_id INTEGER,  -- If responding to another argument
  message_id INTEGER,  -- FK to messages table
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (session_id) REFERENCES debate_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (round_id) REFERENCES debate_rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX idx_debate_arguments_session ON debate_arguments(session_id);
CREATE INDEX idx_debate_arguments_round ON debate_arguments(round_id);

CREATE TABLE debate_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  choice TEXT NOT NULL,  -- The voted position or argument ID
  justification TEXT,
  confidence REAL,  -- 0.0-1.0
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (session_id) REFERENCES debate_sessions(id) ON DELETE CASCADE,
  UNIQUE(session_id, agent_name)  -- One vote per agent per session
);

CREATE INDEX idx_debate_votes_session ON debate_votes(session_id);
```

### Hermes Chat Integration

Debate messages are stored in the existing `messages` table using `conversation_id = "debate:{session_id}"`.
This means:
- Existing chat UI can display debate conversations (read-only view)
- SSE `chat.message` events work without modification
- The debate engine writes messages with `message_type = 'debate_argument'` or `'debate_vote'`

### LLM Integration for Agent Participation

The debate engine constructs agent prompts using:
1. The debate topic and current round context
2. Previous arguments from other participants
3. The agent's persona (if persona system is active, see System 4)
4. Position instruction (e.g., "Argue FOR this proposal and provide evidence")

This goes through existing agent communication: the engine calls the gateway/LLM router
to get agent responses, which are then stored as debate arguments.

### New EventBus Types

```typescript
| 'debate.session.created'
| 'debate.round.started'
| 'debate.round.closed'
| 'debate.argument.submitted'
| 'debate.vote.cast'
| 'debate.consensus.reached'
| 'debate.session.completed'
```

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/debates` | GET, POST | List/create debate sessions |
| `/api/debates/[id]` | GET, PUT, DELETE | CRUD single session |
| `/api/debates/[id]/rounds` | GET, POST | List rounds / advance to next round |
| `/api/debates/[id]/arguments` | GET, POST | List/submit arguments |
| `/api/debates/[id]/vote` | POST | Cast vote |
| `/api/debates/[id]/tally` | GET | Get vote tally / consensus status |

---

## System 4: Deep Persona Simulation

### Architecture

```
  +-------------------+                           +-------------------+
  | persona-editor    |     REST CRUD              | persona-engine.ts |
  | -panel.tsx        | ---/api/personas/------->  | (trait modeling)   |
  | (Big Five sliders)|                           +-------------------+
  +-------------------+                                   |
         |                                                | buildPersonaPrompt()
         v                                                v
  +-------------------+                           +-------------------+
  | Agent CRUD        |     soul_content          | LLM Prompt        |
  | (existing)        | <--- persona injection -> | Construction      |
  +-------------------+                           +-------------------+
```

**Confidence:** HIGH for trait storage and prompt injection.
LOW for emotional state transitions and cognitive bias modeling (experimental, needs iteration).

### Big Five Trait Model

Each agent gets a persona profile with scores on the OCEAN model (0.0 - 1.0):

| Trait | Low Score Behavior | High Score Behavior |
|-------|-------------------|-------------------|
| **O**penness | Conservative, practical, conventional | Creative, curious, willing to experiment |
| **C**onscientiousness | Flexible, spontaneous, casual | Methodical, thorough, detail-oriented |
| **E**xtraversion | Reserved, focused, independent | Collaborative, verbose, seeks interaction |
| **A**greeableness | Challenging, competitive, skeptical | Cooperative, trusting, consensus-seeking |
| **N**euroticism | Calm, resilient, stable under pressure | Anxious, cautious, risk-averse |

### Prompt Construction

The persona engine converts trait scores to natural language injected into the agent's
system prompt (the `soul_content` field on the agents table):

```typescript
// persona-engine.ts
export function buildPersonaPrompt(profile: PersonaProfile): string {
  const lines: string[] = []

  // Openness
  if (profile.openness > 0.7) {
    lines.push('You are highly creative and open to unconventional solutions.')
  } else if (profile.openness < 0.3) {
    lines.push('You prefer proven, conventional approaches over experimentation.')
  }

  // Conscientiousness
  if (profile.conscientiousness > 0.7) {
    lines.push('You are meticulous and thorough. Always verify details before proceeding.')
  } else if (profile.conscientiousness < 0.3) {
    lines.push('You favor speed and pragmatism over exhaustive verification.')
  }

  // Extraversion
  if (profile.extraversion > 0.7) {
    lines.push('You actively engage with other agents, share updates frequently, and seek collaboration.')
  } else if (profile.extraversion < 0.3) {
    lines.push('You work independently and communicate concisely, only when necessary.')
  }

  // Agreeableness
  if (profile.agreeableness > 0.7) {
    lines.push('You seek consensus and are cooperative. You assume good intent from others.')
  } else if (profile.agreeableness < 0.3) {
    lines.push('You are skeptical and challenge assumptions. You play devil\'s advocate when warranted.')
  }

  // Neuroticism
  if (profile.neuroticism > 0.7) {
    lines.push('You are cautious and risk-averse. Flag potential issues early and often.')
  } else if (profile.neuroticism < 0.3) {
    lines.push('You remain calm under pressure and do not over-react to setbacks.')
  }

  // Emotional state overlay (if active)
  if (profile.emotional_state) {
    lines.push(`Current emotional context: ${profile.emotional_state}`)
  }

  return lines.join(' ')
}
```

### Emotional State Transitions (LOW confidence)

Emotional states are event-driven, updated by the persona engine when certain triggers occur:

```
  NEUTRAL --[task_failed]--> FRUSTRATED --[task_completed]--> SATISFIED --> NEUTRAL
  NEUTRAL --[overloaded]--> STRESSED --[workload_reduced]--> RELIEVED --> NEUTRAL
  NEUTRAL --[praised]-----> MOTIVATED --[time_decay]-------> NEUTRAL
```

The state machine is intentionally simple. State transitions are triggered by EventBus events
(`task.status_changed`, `agent.status_changed`) and decay back to NEUTRAL after a configurable
timeout (default: 30 minutes). This is experimental and should be behind a feature flag.

### Data Model

```sql
-- Migration: 061_persona_profiles
CREATE TABLE persona_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL UNIQUE,
  openness REAL NOT NULL DEFAULT 0.5,
  conscientiousness REAL NOT NULL DEFAULT 0.5,
  extraversion REAL NOT NULL DEFAULT 0.5,
  agreeableness REAL NOT NULL DEFAULT 0.5,
  neuroticism REAL NOT NULL DEFAULT 0.5,
  cognitive_biases TEXT,     -- JSON: string[] (e.g., ["confirmation_bias", "anchoring"])
  communication_style TEXT,  -- JSON: { verbosity, formality, emoji_usage }
  backstory TEXT,            -- Free-form backstory text
  workspace_id INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_persona_profiles_agent ON persona_profiles(agent_id);

CREATE TABLE persona_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  emotional_state TEXT NOT NULL DEFAULT 'neutral',
  trigger_event TEXT,        -- What caused the state change
  intensity REAL NOT NULL DEFAULT 0.5,  -- 0.0-1.0
  expires_at INTEGER,        -- When state decays to neutral
  workspace_id INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_persona_states_agent ON persona_states(agent_id);
CREATE INDEX idx_persona_states_expires ON persona_states(expires_at);
```

### Integration with Agent CRUD

The persona system extends agent creation/editing:
- When an agent has a `persona_profiles` row, `buildPersonaPrompt()` is called and the result
  is prepended to the agent's `soul_content` before sending to the LLM
- The persona editor panel is a tab within the existing `agent-detail-tabs.tsx`
- No changes needed to the agent table schema -- persona data lives in its own table

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/personas/[agentId]` | GET, PUT | Get/update persona profile for an agent |
| `/api/personas/[agentId]/state` | GET, POST | Get current emotional state / trigger state change |
| `/api/personas/presets` | GET | List persona presets (e.g., "Cautious Analyst", "Bold Creative") |

---

## System 5: Auto-Scaling

### Architecture

```
  +-------------------+                           +-------------------+
  | scaling-monitor   |     REST/SSE               | scaling-engine.ts |
  | -panel.tsx        | <---/api/scaling/------->  | (threshold mgr)   |
  | (pool dashboard)  |                           +-------------------+
  +-------------------+                                   |
                                                          | Subscribes to EventBus
                                                          | task.created, task.status_changed
                                                          | agent.status_changed
                                                          v
                                                  +-------------------+
                                                  | Evaluation Loop   |
                                                  | (lazy, on-access) |
                                                  +-------------------+
                                                          |
                                                  +-------v-------+
                                                  | Scale Decision |
                                                  +---+-------+---+
                                                      |       |
                                                 SCALE UP  SCALE DOWN
                                                      |       |
                                                      v       v
                                              +-----------+ +-----------+
                                              | Spawn     | | Retire    |
                                              | Agent     | | Agent     |
                                              | (template)| | (idle)    |
                                              +-----------+ +-----------+
```

**Confidence:** MEDIUM -- The pattern is standard (queue depth scaling), but the SQLite-only
constraint means no external queue. We use a polling/lazy-evaluation pattern instead of
real-time stream processing.

### Why Not setInterval

Per the debugging lesson in MEMORY.md: "Module-level timers leak because scope persists in
serverless." The scaling engine uses **lazy eviction on access** instead:

```typescript
// scaling-engine.ts
let lastEvaluation = 0
const EVAL_COOLDOWN_MS = 30_000 // 30 seconds

export function maybeEvaluateScaling(db: Database, workspaceId: number): ScalingDecision | null {
  const now = Date.now()
  if (now - lastEvaluation < EVAL_COOLDOWN_MS) return null
  lastEvaluation = now

  // Count pending tasks (queue depth)
  const pending = db.prepare(`
    SELECT COUNT(*) as count FROM tasks
    WHERE workspace_id = ? AND status IN ('inbox', 'assigned')
  `).get(workspaceId) as { count: number }

  // Count available agents
  const available = db.prepare(`
    SELECT COUNT(*) as count FROM agents
    WHERE workspace_id = ? AND status IN ('idle', 'offline')
  `).get(workspaceId) as { count: number }

  // Load active scaling policy
  const policy = getActivePolicy(db, workspaceId)
  if (!policy) return null

  // Evaluate thresholds
  if (pending.count > policy.scale_up_threshold && available.count < policy.max_agents) {
    return { action: 'scale_up', reason: `Queue depth ${pending.count} > threshold ${policy.scale_up_threshold}` }
  }

  if (pending.count < policy.scale_down_threshold && available.count > policy.min_agents) {
    return { action: 'scale_down', reason: `Queue depth ${pending.count} < threshold ${policy.scale_down_threshold}` }
  }

  return null
}
```

### Scaling Trigger Points

The evaluation is called lazily from:
1. `POST /api/tasks` -- after task creation (most common trigger)
2. `PUT /api/tasks/[id]` -- after task status change
3. `GET /api/scaling/evaluate` -- manual evaluation endpoint
4. `POST /api/scaling/evaluate` -- force evaluation (admin only)

### Cooldown Mechanism

```
  Scale-Up Event
       |
       v
  [COOLDOWN: 5 min] ---> Block further scale-ups
       |
  (cooldown expires)
       |
       v
  Next evaluation allowed
```

Cooldowns are per-direction: scale-up cooldown is independent of scale-down cooldown.
Stored in-memory (not DB) since they are transient and should reset on server restart.

### Spawn Flow

When a scale-up decision is made:
1. Load the policy's `template_id` (references `agent-templates.ts`)
2. Generate a unique name: `{template.type}-auto-{timestamp}`
3. Call existing `POST /api/agents` internally with the template config
4. Assign pending tasks to the new agent via existing task assignment logic
5. Log scaling event to `scaling_events` table
6. Broadcast `scaling.agent.spawned` via EventBus

### Data Model

```sql
-- Migration: 062_scaling_policies
CREATE TABLE scaling_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  min_agents INTEGER NOT NULL DEFAULT 1,
  max_agents INTEGER NOT NULL DEFAULT 10,
  scale_up_threshold INTEGER NOT NULL DEFAULT 5,    -- Queue depth to trigger scale-up
  scale_down_threshold INTEGER NOT NULL DEFAULT 1,  -- Queue depth to trigger scale-down
  cooldown_seconds INTEGER NOT NULL DEFAULT 300,    -- 5 min cooldown between scaling actions
  template_name TEXT,         -- Agent template to use for spawning
  agent_role_filter TEXT,     -- Only scale agents with this role
  workspace_id INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_scaling_policies_workspace ON scaling_policies(workspace_id);

CREATE TABLE scaling_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id INTEGER NOT NULL,
  action TEXT NOT NULL,        -- scale_up|scale_down|cooldown_blocked
  reason TEXT NOT NULL,
  agent_id INTEGER,            -- The agent spawned or retired
  queue_depth INTEGER,         -- Snapshot of queue depth at decision time
  agent_count INTEGER,         -- Snapshot of agent count at decision time
  workspace_id INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (policy_id) REFERENCES scaling_policies(id) ON DELETE CASCADE
);

CREATE INDEX idx_scaling_events_workspace ON scaling_events(workspace_id);
CREATE INDEX idx_scaling_events_created ON scaling_events(created_at);

CREATE TABLE scaling_pool_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  total_agents INTEGER NOT NULL,
  idle_agents INTEGER NOT NULL,
  busy_agents INTEGER NOT NULL,
  pending_tasks INTEGER NOT NULL,
  assigned_tasks INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL DEFAULT 1,
  captured_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_pool_snapshots_workspace ON scaling_pool_snapshots(workspace_id);
CREATE INDEX idx_pool_snapshots_captured ON scaling_pool_snapshots(captured_at);
```

### New EventBus Types

```typescript
| 'scaling.evaluated'
| 'scaling.agent.spawned'
| 'scaling.agent.retired'
| 'scaling.cooldown.active'
```

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/scaling/policies` | GET, POST | List/create scaling policies |
| `/api/scaling/policies/[id]` | GET, PUT, DELETE | CRUD single policy |
| `/api/scaling/evaluate` | GET, POST | Trigger/view scaling evaluation |
| `/api/scaling/events` | GET | List scaling event history |
| `/api/scaling/pool` | GET | Current pool snapshot |

---

## System 6: @Mention Chat Routing

### Architecture

```
  +-------------------+                           +-------------------+
  | chat-page-panel   |     POST /api/chat/       | mention-router.ts |
  | (existing, with   |     messages              | (NEW: routing     |
  |  @mention input)  | -------+----------------> |  logic)           |
  +-------------------+        |                  +-------------------+
                               |                          |
                               v                          v
                       +---------------+          +-------------------+
                       | mentions.ts   |          | coordinator-      |
                       | (existing:    |          | routing.ts        |
                       |  parse +      |          | (existing:        |
                       |  resolve)     |          |  session lookup)  |
                       +---------------+          +-------------------+
```

**Confidence:** HIGH -- The foundation already exists. `mentions.ts` parses @handles,
`/api/mentions` provides autocomplete, and the chat message POST route already handles
forwarding. The gap is wiring parsed mentions into the forwarding logic.

### What Already Exists

1. **`src/lib/mentions.ts`**: `parseMentions(text)` extracts @tokens, `resolveMentionRecipients()`
   matches them to agents/users, returns `MentionResolution`
2. **`/api/mentions`**: GET endpoint for autocomplete (used by chat input)
3. **`POST /api/chat/messages`**: Already supports `body.forward` and `body.to` for agent routing
4. **`src/lib/coordinator-routing.ts`**: Resolves which gateway session to deliver to

### What Needs to Be Built

The gap: when a user types `@analyst please review this`, the chat UI needs to:
1. Extract `@analyst` from the message content
2. Resolve it to an agent name via `resolveMentionRecipients()`
3. Set `body.to = resolvedAgent.recipient` and `body.forward = true`
4. If multiple @mentions, either fan-out to all mentioned agents or route to the first one

### Multi-Mention Strategy

```
  User: "@analyst @architect please review the design"
                    |
         parseMentions() -> ["analyst", "architect"]
                    |
         resolveMentionRecipients() -> [Agent("analyst"), Agent("architect")]
                    |
         +----------+----------+
         |                     |
    Message 1               Message 2
    to: "analyst"           to: "architect"
    forward: true           forward: true
    conversation_id:        conversation_id:
    same as original        same as original
```

Fan-out creates separate forwarded messages per agent but keeps the same `conversation_id`
so replies appear in the same thread.

### Implementation Location

This is a **thin layer** on top of existing code:

```typescript
// src/lib/mention-router.ts
import { resolveMentionRecipients, MentionResolution } from './mentions'
import type { Database } from 'better-sqlite3'

export interface MentionRouteResult {
  targets: Array<{ name: string; type: 'user' | 'agent' }>
  unresolved: string[]
  shouldForward: boolean
}

export function routeMentions(
  content: string,
  db: Database,
  workspaceId: number
): MentionRouteResult {
  const resolution = resolveMentionRecipients(content, db, workspaceId)

  const agentTargets = resolution.resolved.filter(r => r.type === 'agent')
  const userTargets = resolution.resolved.filter(r => r.type === 'user')

  return {
    targets: resolution.resolved.map(r => ({ name: r.recipient, type: r.type })),
    unresolved: resolution.unresolved,
    shouldForward: agentTargets.length > 0,
  }
}
```

The `POST /api/chat/messages` route is then modified to:
1. Call `routeMentions()` on the message content
2. If `shouldForward` and no explicit `body.to`, use the first agent target
3. If multiple agent targets, create additional forwarded messages

### No New Tables Needed

This system uses existing tables: `messages`, `agents`, `users`.
No new migrations required.

### No New EventBus Types Needed

Uses existing `chat.message` events. The SSE stream already delivers these to clients.

### API Changes

| Route | Change | Purpose |
|-------|--------|---------|
| `POST /api/chat/messages` | Modified | Auto-detect @mentions when `body.to` is not set |
| `GET /api/mentions` | No change | Already provides autocomplete data |

---

## Recommended Project Structure

```
src/
├── app/api/
│   ├── spatial/                  # NEW: Spatial visualization API
│   │   ├── layouts/
│   │   │   ├── route.ts          # GET (list), POST (create)
│   │   │   └── [id]/route.ts     # GET, PUT, DELETE
│   │   ├── edges/
│   │   │   ├── route.ts          # GET, POST
│   │   │   └── [id]/route.ts     # PUT, DELETE
│   │   └── auto-layout/route.ts  # POST (compute layout)
│   ├── workflows/                # NEW: Workflow engine API
│   │   ├── sops/
│   │   │   ├── route.ts
│   │   │   └── [id]/route.ts
│   │   └── runs/
│   │       ├── route.ts
│   │       ├── [id]/route.ts
│   │       ├── [id]/advance/route.ts
│   │       └── [id]/steps/route.ts
│   ├── debates/                  # NEW: Debate system API
│   │   ├── route.ts
│   │   └── [id]/
│   │       ├── route.ts
│   │       ├── rounds/route.ts
│   │       ├── arguments/route.ts
│   │       ├── vote/route.ts
│   │       └── tally/route.ts
│   ├── personas/                 # NEW: Persona system API
│   │   ├── [agentId]/
│   │   │   ├── route.ts
│   │   │   └── state/route.ts
│   │   └── presets/route.ts
│   ├── scaling/                  # NEW: Auto-scaling API
│   │   ├── policies/
│   │   │   ├── route.ts
│   │   │   └── [id]/route.ts
│   │   ├── evaluate/route.ts
│   │   ├── events/route.ts
│   │   └── pool/route.ts
│   ├── chat/messages/route.ts    # MODIFIED: @mention routing
│   └── events/route.ts          # MODIFIED: new SSE event types
├── components/panels/
│   ├── spatial-canvas-panel.tsx  # NEW: React Flow canvas
│   ├── workflow-runner-panel.tsx # NEW: SOP execution dashboard
│   ├── debate-room-panel.tsx    # NEW: Deliberation UI
│   ├── persona-editor-panel.tsx # NEW: Big Five trait editor (tab in agent detail)
│   ├── scaling-monitor-panel.tsx # NEW: Auto-scaling dashboard
│   └── agent-detail-tabs.tsx    # MODIFIED: add persona tab
├── components/spatial/           # NEW: React Flow custom components
│   ├── AgentNode.tsx
│   ├── TaskNode.tsx
│   ├── MessageEdge.tsx
│   ├── WorkflowEdge.tsx
│   └── canvas-controls.tsx
├── lib/
│   ├── spatial-engine.ts        # NEW: Layout computation, auto-layout
│   ├── workflow-engine.ts       # NEW: SOP state machine, phase execution
│   ├── debate-engine.ts         # NEW: Round management, vote tallying
│   ├── persona-engine.ts        # NEW: Trait-to-prompt, emotional state
│   ├── scaling-engine.ts        # NEW: Queue depth evaluation, spawning
│   ├── mention-router.ts        # NEW: @mention -> agent forwarding
│   ├── event-bus.ts             # MODIFIED: new event types
│   ├── mentions.ts              # EXISTING: parse + resolve (unchanged)
│   ├── migrations.ts            # MODIFIED: 5 new migrations (058-062)
│   └── db.ts                    # EXISTING: unchanged
└── store/
    ├── index.ts                 # MODIFIED: new slices for workflows, debates, scaling
    └── canvas-store.ts          # NEW: React Flow node/edge state
```

### Structure Rationale

- **`components/spatial/`**: Isolated folder for React Flow custom nodes/edges because they
  have unique import requirements (`@xyflow/react`) and should not pollute the panels folder
- **`lib/*-engine.ts`**: Each system gets its own engine module following the existing pattern
  (like `coordinator-routing.ts`, `injection-guard.ts`)
- **API routes follow existing conventions**: `requireRole() -> validateBody() -> getDatabase() -> NextResponse.json()`
- **Single Zustand store extended** (not replaced) for most systems, with a separate store only
  for React Flow canvas state

---

## Architectural Patterns

### Pattern 1: EventBus-Driven Side Effects

**What:** When a mutation occurs (DB write), broadcast via EventBus. Other systems subscribe
and react. No direct coupling between systems.

**When to use:** Cross-system notifications (workflow step completes -> spatial canvas updates
node -> auto-scaler checks queue depth).

**Trade-offs:**
- Pro: Loose coupling, easy to add new subscribers
- Con: Debugging event chains is harder; no guaranteed delivery order

**Example:**
```typescript
// In workflow-engine.ts
function completeWorkflowStep(db: Database, runId: number, stepId: string) {
  db.prepare('UPDATE workflow_run_steps SET status = ? WHERE ...').run('completed')

  // Side effect 1: Task board hears about it
  eventBus.broadcast('workflow.step.completed', { runId, stepId })

  // The spatial canvas, auto-scaler, and debate system each independently
  // subscribe to relevant events without knowing about each other.
}
```

### Pattern 2: Lazy Evaluation with Cooldown

**What:** Instead of polling on an interval (which leaks in serverless), evaluate on access
with a minimum cooldown between evaluations.

**When to use:** Auto-scaling, resource monitoring, any periodic check in a serverless context.

**Trade-offs:**
- Pro: No leaked timers, no wasted CPU when no traffic
- Con: Evaluation only happens when traffic arrives (cold system stays cold)

**Example:** See scaling-engine.ts `maybeEvaluateScaling()` above.

### Pattern 3: Conversation Namespacing

**What:** Reuse the existing `messages` table for debate conversations by namespacing
`conversation_id` (e.g., `"debate:{id}"`).

**When to use:** When a new feature needs message-like data but should share infrastructure
with existing chat.

**Trade-offs:**
- Pro: No new message table, SSE events work automatically, chat UI can view threads
- Con: Query performance at scale if messages table grows large (mitigated by index on conversation_id)

### Pattern 4: Separate Zustand Store for High-Frequency State

**What:** Canvas node positions update on every drag (60fps). Keep this in a separate store
to avoid re-rendering unrelated panels.

**When to use:** Any subsystem with high-frequency state updates that would cascade through
the main store's `subscribeWithSelector`.

**Trade-offs:**
- Pro: Performance isolation, no unnecessary re-renders
- Con: Cross-store coordination requires manual subscription bridges

---

## Data Flow

### Request Flow (Standard Pattern)

```
[User Action]
    |
[Panel Component] --fetch()--> [API Route Handler]
    |                              |
    | (optimistic update)          | requireRole()
    | via Zustand                  | validateBody()
    v                              | getDatabase()
[Zustand Store]                    | db.prepare().run()
    ^                              | eventBus.broadcast()
    |                              v
    +--- SSE EventSource <--- [/api/events stream]
         onmessage()               ^
         updateStore()              |
                                [EventBus]
```

### Spatial Canvas Data Flow

```
[Agent Created/Updated in DB]
    |
[eventBus.broadcast('agent.created', data)]
    |
[/api/events SSE stream] --> [EventSource in spatial-canvas-panel]
    |
[useCanvasStore.updateNodeData()] --> [React Flow re-renders affected node]
```

### Workflow Execution Flow

```
[User: "Start SOP run"]
    |
[POST /api/workflows/runs] --> [workflow-engine.ts: createRun()]
    |
[For each step in current phase:]
    |
[Create task in tasks table] --> [eventBus.broadcast('task.created')]
    |                                    |
    |                              [Auto-scaler evaluates queue]
    |
[Agent completes task] --> [PUT /api/tasks/{id} status=done]
    |
[eventBus: task.status_changed] --> [workflow-engine: checkPhaseCompletion()]
    |                                        |
    |                                  [All steps done?]
    |                                  YES: advancePhase()
    |                                  NO: wait for remaining steps
    |
[Phase complete] --> [eventBus: workflow.phase.completed]
    |                        |
    |                  [spatial canvas: update workflow edge]
    |
[Last phase complete] --> [workflow.run.status_changed: completed]
```

### Debate Flow

```
[User: "Create debate session"]
    |
[POST /api/debates] --> [debate-engine: createSession()]
    |
[debate.session.created] --> [SSE to all clients]
    |
[POST /api/debates/{id}/rounds] --> [debate-engine: startRound()]
    |
[For each participant agent:]
    |
[Construct prompt with topic + previous arguments + persona]
    |
[Call LLM via gateway] --> [Store response as debate_argument]
    |                            |
    |                      [Store as message in messages table]
    |                      [conversation_id = "debate:{session_id}"]
    |
[eventBus: debate.argument.submitted] --> [SSE updates debate-room-panel]
    |
[Round complete: all agents submitted]
    |
[debate.round.closed] --> [Check consensus threshold or advance round]
```

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-5 agents, 1 user | Current architecture is fine. No scaling needed. SQLite WAL handles everything. |
| 5-20 agents, 5 users | Add `scaling_pool_snapshots` for historical monitoring. SSE connections scale fine (50 max listeners already set). |
| 20-50 agents, 10 users | **First bottleneck: SQLite write contention.** Workflow and debate engines create many writes. Batch writes in transactions. Pool snapshots should be sampled (every 60s, not every request). |
| 50-100 agents, 20 users | **Second bottleneck: SSE event volume.** Add event filtering: clients subscribe to event types they care about (spatial panel skips debate events). Implement server-side filtering in `/api/events`. |
| 100+ agents | **Consider:** Read-replica pattern with SQLite (separate read-only DB file), or migrate to libSQL/Turso for multi-writer support. This is beyond current scope. |

### SQLite-Specific Considerations

1. **WAL checkpoint starvation:** Long-running SSE connections hold read transactions open.
   Mitigation: The SSE handler in `/api/events` does NOT hold a DB connection open -- it only
   reads from the EventBus (in-memory). This is already correct in the existing code.

2. **Write batching:** Workflow step completions and debate argument submissions should use
   `db.transaction()` to batch related writes (step update + activity log + notification).

3. **Index strategy:** All new tables include indexes on `workspace_id` and the most common
   query columns. Composite indexes are preferred over single-column where the workspace filter
   is always present.

4. **Table cleanup:** `scaling_pool_snapshots` and `persona_states` accumulate rows over time.
   Add a cleanup migration or periodic pruning (DELETE WHERE captured_at < threshold) triggered
   lazily on read, not via setInterval.

---

## Anti-Patterns

### Anti-Pattern 1: Direct Cross-System Calls

**What people do:** Workflow engine directly imports and calls scaling-engine.ts functions.
**Why it's wrong:** Creates tight coupling. Changes in scaling logic break workflow engine.
**Do this instead:** Use EventBus. Workflow engine broadcasts events; scaling engine subscribes.

### Anti-Pattern 2: Fat Zustand Store

**What people do:** Add React Flow nodes/edges to the main `useMissionControl` store.
**Why it's wrong:** Dragging a node causes all 33+ existing panels to re-render evaluation.
**Do this instead:** Separate `useCanvasStore` for React Flow state. Bridge via `subscribeWithSelector`.

### Anti-Pattern 3: setInterval for Scaling Checks

**What people do:** `setInterval(() => evaluateScaling(), 30000)` at module scope.
**Why it's wrong:** Leaks in serverless. Timer persists across HMR. Multiple instances after hot reload.
**Do this instead:** Lazy evaluation on request access with cooldown (see Pattern 2).

### Anti-Pattern 4: Debate Messages in a Separate Table

**What people do:** Create a `debate_messages` table duplicating the `messages` schema.
**Why it's wrong:** Duplicated message infrastructure. SSE events need separate handling.
**Do this instead:** Use `messages` table with `conversation_id = "debate:{id}"` and
`message_type = 'debate_argument'`. Existing SSE and chat UI work automatically.

### Anti-Pattern 5: Storing Persona Prompts in the Persona Table

**What people do:** Store the generated prompt text in `persona_profiles.prompt_cache`.
**Why it's wrong:** Stale cache. Prompt changes when traits change but cache is not invalidated.
**Do this instead:** Always compute `buildPersonaPrompt()` at LLM call time from current trait values.
Computation is fast (string concatenation), caching adds invalidation complexity for no benefit.

---

## Integration Points

### Cross-System Integration Map

| System A | System B | Integration Mechanism | Notes |
|----------|----------|-----------------------|-------|
| Spatial Canvas | Agent CRUD | Zustand `subscribeWithSelector` on `agents[]` | Nodes derived from agent list |
| Spatial Canvas | Chat Messages | SSE `chat.message` events | Animate edges on message flow |
| Spatial Canvas | Workflow Engine | SSE `workflow.phase.completed` events | Update workflow edge visuals |
| Workflow Engine | Task Board | Creates `tasks` rows, links via `workflow_run_steps.task_id` | Tasks appear in task board |
| Workflow Engine | Auto-Scaling | EventBus `task.created` triggers scaling evaluation | More tasks -> more agents |
| Debate Rooms | Hermes Chat | Shared `messages` table, `conversation_id` namespace | Chat UI can view debate threads |
| Debate Rooms | Persona System | `buildPersonaPrompt()` injected into debate agent prompts | Personality shapes arguments |
| Persona System | Agent CRUD | `persona_profiles.agent_id` FK, prompt injected at LLM call time | Non-breaking extension |
| Auto-Scaling | Agent Templates | `scaling_policies.template_name` references template library | Spawns from templates |
| Auto-Scaling | Agent CRUD | Calls `POST /api/agents` internally to create agents | Uses existing creation flow |
| @Mention Router | mentions.ts | Imports existing `resolveMentionRecipients()` | Zero duplication |
| @Mention Router | Chat Messages | Modifies `POST /api/chat/messages` to auto-detect mentions | Minimal diff to existing route |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Canvas Store <-> Main Store | `subscribeWithSelector` bridge | One-way: main -> canvas (agents, tasks) |
| Workflow Engine <-> Task System | Direct DB writes + EventBus | Engine creates tasks, listens for completions |
| Debate Engine <-> Chat System | Shared messages table | Debate writes to messages, chat SSE delivers |
| Persona Engine <-> Agent System | `buildPersonaPrompt()` called at LLM time | No persistent coupling beyond the FK |
| Scaling Engine <-> Agent System | Internal API call (`POST /api/agents`) | Uses same route as manual agent creation |
| Mention Router <-> Chat System | Thin wrapper in message POST handler | <20 lines of routing logic |

---

## Migration Numbering

Assuming the current migration count is 57 (based on project context), new migrations:

| Migration ID | System | Tables Created |
|-------------|--------|----------------|
| `058_spatial_layouts` | Spatial Canvas | `spatial_layouts`, `spatial_edges` |
| `059_workflow_sops` | Workflow Engine | `workflow_sops`, `workflow_runs`, `workflow_run_steps` |
| `060_debate_sessions` | Debate Rooms | `debate_sessions`, `debate_rounds`, `debate_arguments`, `debate_votes` |
| `061_persona_profiles` | Persona System | `persona_profiles`, `persona_states` |
| `062_scaling_policies` | Auto-Scaling | `scaling_policies`, `scaling_events`, `scaling_pool_snapshots` |

Total: 5 new migrations, 14 new tables.

No existing tables are modified -- all integration is via FKs pointing to existing tables
(`agents.id`, `tasks.id`, `messages.id`).

---

## EventBus Extension

Complete list of new event types to add to `src/lib/event-bus.ts`:

```typescript
export type EventType =
  // ... existing types ...
  // Spatial Canvas
  | 'spatial.layout.updated'
  | 'spatial.node.moved'
  // Workflow Engine
  | 'workflow.run.created'
  | 'workflow.run.status_changed'
  | 'workflow.phase.started'
  | 'workflow.phase.completed'
  | 'workflow.step.completed'
  // Debate Rooms
  | 'debate.session.created'
  | 'debate.round.started'
  | 'debate.round.closed'
  | 'debate.argument.submitted'
  | 'debate.vote.cast'
  | 'debate.consensus.reached'
  | 'debate.session.completed'
  // Auto-Scaling
  | 'scaling.evaluated'
  | 'scaling.agent.spawned'
  | 'scaling.agent.retired'
  | 'scaling.cooldown.active'
```

---

## NPM Dependencies

| Package | Version | Purpose | Bundle Impact |
|---------|---------|---------|---------------|
| `@xyflow/react` | ^12.x | React Flow canvas | ~180KB gzipped (client-only, lazy-loadable) |
| `dagre` | ^0.8.x | Auto-layout algorithm for graph | ~30KB (server-side computation) |

No other new dependencies required. All other systems use existing packages
(better-sqlite3, zustand, zod, next).

---

## Sources

- [React Flow + Zustand integration](https://reactflow.dev/learn/advanced-use/state-management) -- Official xyflow documentation
- [React Flow Custom Nodes](https://reactflow.dev/learn/customization/custom-nodes) -- Official guide
- [React Flow Node Status Indicator](https://reactflow.dev/ui/components/node-status-indicator) -- Built-in status component
- [State Management in React Flow (Synergy Codes)](https://www.synergycodes.com/blog/state-management-in-react-flow) -- Architecture deep-dive
- [LangGraph Multi-Agent Orchestration](https://latenode.com/blog/ai-frameworks-technical-infrastructure/langgraph-multi-agent-orchestration/langgraph-multi-agent-orchestration-complete-framework-guide-architecture-analysis-2025) -- DAG/state machine patterns
- [Multi-Agent Orchestration Patterns 2026](https://www.ai-agentsplus.com/blog/multi-agent-orchestration-patterns-2026) -- Coordination patterns
- [2026 Guide to Agentic Workflow Architectures](https://www.stackai.com/blog/the-2026-guide-to-agentic-workflow-architectures) -- Workflow engine comparison
- [MetaGPT: Meta Programming for Multi-Agent Collaborative Framework](https://arxiv.org/abs/2308.00352) -- SOP architecture reference
- [MetaGPT Multi Agent Framework 2026](https://aiinovationhub.com/metagpt-multi-agent-framework-explained/) -- SOP + structured output patterns
- [Patterns for Democratic Multi-Agent AI: Debate-Based Consensus](https://medium.com/@edoardo.schepis/patterns-for-democratic-multi-agent-ai-debate-based-consensus-part-1-8ef80557ff8a) -- Debate architecture
- [Voting or Consensus? Decision-Making in Multi-Agent Debate (ACL 2025)](https://aclanthology.org/2025.findings-acl.606/) -- Voting vs consensus research
- [Decision Protocols in Multi-Agent Debate (GitHub)](https://github.com/lkaesberg/decision-protocols) -- Implementation reference
- [Big Five Personality Profiles in LLMs](https://www.emergentmind.com/topics/big-five-personality-profiles-in-llms) -- Personality trait survey
- [BIG5-CHAT: Shaping LLM Personalities Through Training (ACL 2025)](https://aclanthology.org/2025.acl-long.999.pdf) -- Training-based personality
- [PersonaLLM: Personality Simulation](https://www.emergentmind.com/topics/personallm) -- Persona simulation patterns
- [Auto-Scaling Worker Pools for Event Processing (2025)](https://scalabrix.medium.com/system-architecture-auto-scaling-worker-pools-for-event-processing-at-scale-7cb3368ac8b9) -- Queue depth scaling
- [Autoscaling Guidance (Azure Architecture Center)](https://learn.microsoft.com/en-us/azure/architecture/best-practices/auto-scaling) -- Threshold + cooldown patterns
- [Scalable Multi-Agent Chat Using @mentions (n8n)](https://n8n.io/workflows/3473-scalable-multi-agent-chat-using-mentions/) -- @mention routing pattern
- [SQLite WAL Mode](https://sqlite.org/wal.html) -- Concurrency characteristics
- [How SQLite Scales Read Concurrency (Fly.io)](https://fly.io/blog/sqlite-internals-wal/) -- WAL performance analysis
- [better-sqlite3 Performance](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) -- Write batching guidance

---
*Architecture research for: AI multi-agent orchestration platform -- 6-system integration*
*Researched: 2026-03-15*
