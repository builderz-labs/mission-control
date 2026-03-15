# Stack Research: Phase 6 Feature Expansion

**Domain:** AI multi-agent orchestration platform
**Researched:** 2026-03-15
**Confidence:** HIGH (existing codebase verified, library versions confirmed via npm/GitHub)

## Existing Stack Baseline

Before recommending additions, here is what the project already has:

| Dependency | Version | Status | Relevance |
|---|---|---|---|
| `@xyflow/react` | ^12.10.0 | **ALREADY INSTALLED** | Spatial 2D canvas (Feature 1) |
| `reactflow` | ^11.11.4 | **ALREADY INSTALLED (legacy)** | Duplicate -- remove after migration |
| `reagraph` | ^4.30.8 | **ALREADY INSTALLED** | 3D graph viz (not needed for 2D) |
| `zustand` | ^5.0.11 | **ALREADY INSTALLED** | State management for all features |
| `zod` | ^4.3.6 | **ALREADY INSTALLED** | Schema validation for workflows/debates |
| `better-sqlite3` | ^12.6.2 | **ALREADY INSTALLED** | Persistence layer for all features |
| `pino` | ^10.3.1 | **ALREADY INSTALLED** | Structured logging |
| `ws` | ^8.19.0 | **ALREADY INSTALLED** | WebSocket (potential real-time upgrade path) |
| `react-markdown` | ^10.1.0 | **ALREADY INSTALLED** | Markdown rendering in chat |
| `next-intl` | ^4.8.3 | **ALREADY INSTALLED** | i18n |

### Existing Engines (Already Built)

| Engine | File | What It Does | Coverage |
|---|---|---|---|
| SOP Engine | `src/lib/sop-engine.ts` | MetaGPT pub-sub workflow execution with Zod output validation | ~70% of Feature 2 |
| Conversation Engine | `src/lib/conversation-engine.ts` | AI Town lifecycle + ChatDev consensus + hop guard | ~50% of Feature 3 |
| Persona Engine | `src/lib/persona-engine.ts` | Big Five traits, mental state, preset templates | ~60% of Feature 4 |
| Simulation Engine | `src/lib/simulation-engine.ts` | AI Town tick loop with priority-based agent behavior | ~30% of Feature 5 |
| Consensus Engine | `src/lib/consensus-engine.ts` | Raft-lite cluster leader election | Cluster-level only |
| Topology Panel | `src/components/panels/topology-panel.tsx` | @xyflow/react canvas with cluster + agent nodes | ~30% of Feature 1 |
| Chat Messages API | `src/app/api/chat/messages/route.ts` | Full chat CRUD + coordinator forwarding | ~40% of Feature 6 |
| Workload API | `src/app/api/workload/route.ts` | Queue depth, agent saturation, throttle recommendations | ~40% of Feature 5 |
| Agent Templates | `src/lib/agent-templates.ts` | 7 OpenClaw agent archetypes with full config | Foundation for Feature 5 |
| Event Bus | `src/lib/event-bus.ts` | SSE broadcast with typed events | Foundation for all features |

---

## Feature 1: Spatial 2D Visualization

### What Exists
- `topology-panel.tsx` already renders @xyflow/react with custom `ClusterNode` and `AgentNode` types, animated edges, Background, Controls, MiniMap
- Uses `useNodesState`/`useEdgesState` hooks with manual position layout
- Fetches from `/api/cluster/heartbeat` and `/api/claude/sessions`

### What's Missing
- Auto-layout algorithm (nodes are manually positioned)
- Message flow animations along edges (particle/SVG path animation)
- Team topology grouping (parent/child nodes)
- Real-time SSE-driven updates (currently polling every 5s)
- Relationship edge types (delegation, communication, supervision)
- Interactive node details (click to expand agent info)
- Zustand integration for canvas state (currently local useState)

### Recommended Stack

| Library | Version | Purpose | Confidence |
|---|---|---|---|
| `@xyflow/react` | ^12.10.1 | Core canvas (ALREADY INSTALLED at ^12.10.0) | HIGH |
| `@dagrejs/dagre` | ^2.0.4 | Automatic directed graph layout | HIGH |
| CSS animations (native) | -- | Edge particle/flow animations via `@keyframes` + `offset-path` | HIGH |

**NO NEW RUNTIME DEPENDENCIES NEEDED** for the core canvas.

### Layout Algorithm Decision

| Option | Package | When to Use |
|---|---|---|
| **dagre (RECOMMENDED)** | `@dagrejs/dagre` | Hierarchical tree layout -- fits agent delegation topology |
| elkjs | `elkjs` | Complex constraint-based layout -- overkill for agent trees |
| d3-hierarchy | `d3-hierarchy` | Single-root tree only -- too restrictive for multi-team graphs |

**Decision:** Use `@dagrejs/dagre` for auto-layout. It is lightweight (26KB), synchronous (no async complexity), and the official React Flow documentation recommends it for directed graph trees. The existing topology panel already uses a hierarchical master-node + peer/agent structure that maps perfectly to dagre's top-down layout.

### Zustand Integration Pattern

React Flow officially recommends Zustand for external state management. Since MC already uses Zustand 5 with `subscribeWithSelector`, create a dedicated canvas store slice:

```typescript
// Pattern from React Flow docs + MC convention
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Node, Edge, OnNodesChange, OnEdgesChange } from '@xyflow/react'
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react'

interface CanvasState {
  nodes: Node[]
  edges: Edge[]
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  setNodes: (nodes: Node[]) => void
  setEdges: (edges: Edge[]) => void
  selectedNodeId: string | null
  selectNode: (id: string | null) => void
}

export const useCanvasStore = create<CanvasState>()(
  subscribeWithSelector((set, get) => ({
    nodes: [],
    edges: [],
    onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
    onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
    setNodes: (nodes) => set({ nodes }),
    setEdges: (edges) => set({ edges }),
    selectedNodeId: null,
    selectNode: (id) => set({ selectedNodeId: id }),
  }))
)
```

### Edge Animation Pattern

Use CSS `offset-path` for message flow particles along SVG edge paths. No framer-motion needed -- CSS animations are sufficient and avoid adding a 30KB dependency.

```css
@keyframes flowParticle {
  from { offset-distance: 0%; }
  to { offset-distance: 100%; }
}
.flow-particle {
  offset-path: path('M0,0 C50,50 100,0 150,50'); /* dynamic from edge path */
  animation: flowParticle 2s linear infinite;
}
```

### Sources
- [React Flow 12 Release](https://xyflow.com/blog/react-flow-12-release) -- SSR/SSG support, TypeScript improvements | HIGH
- [React Flow State Management Guide](https://reactflow.dev/learn/advanced-use/state-management) -- Zustand integration pattern | HIGH
- [React Flow Layout Overview](https://reactflow.dev/learn/layouting/layouting) -- dagre vs elkjs vs d3-hierarchy comparison | HIGH
- [React Flow Dagre Example](https://reactflow.dev/examples/layout/dagre) -- Implementation reference | HIGH
- [React Flow Animating Edges](https://reactflow.dev/examples/edges/animating-edges) -- CSS offset-path pattern | HIGH
- [@dagrejs/dagre npm](https://www.npmjs.com/package/@dagrejs/dagre) -- v2.0.4 actively maintained | HIGH
- [React Flow + React 19 compatibility](https://x.com/xyflowdev/status/1877044785485087175) -- Confirmed via Zustand update | HIGH

---

## Feature 2: Structured Workflow Engine (SOP Enhancement)

### What Exists
`src/lib/sop-engine.ts` already implements:
- MetaGPT pub-sub routing (roles declare watches, pipeline emerges from subscriptions)
- Profile-Goal-Constraint roles with auto-generated system prompts
- Dual-content messages (natural language + validated JSON artifact via Zod)
- Round-based execution with max-rounds guard
- Output validation with `repairAndParse()`
- Budget enforcement via `checkAgentBudget()`
- 2 pre-built templates: `software_project` (5 roles) and `code_review` (2 roles, composed loop)
- API route at `/api/workflows/sop/start`
- DB tables: `sop_messages`, `sop_role_state`

### What's Missing
- **Parallel execution:** Current `executeRound()` processes roles sequentially. Need `Promise.allSettled()` for independent roles.
- **Conditional branching:** No `if/else` phase routing based on artifact content.
- **Phase graph visualization:** No visual representation of the workflow DAG.
- **Pause/resume:** No way to pause a running workflow and resume later.
- **Custom template CRUD:** Templates are hardcoded in `SOP_TEMPLATES` object. Need DB-backed template storage.
- **Artifact schema registry:** `ActionNodeDef` is inline per action. Need a shared registry.
- **Human-in-the-loop gates:** No approval checkpoints between phases.

### Recommended Stack

| Component | Approach | Confidence |
|---|---|---|
| Parallel execution | `Promise.allSettled()` on independent role actions | HIGH |
| Conditional branching | JSON predicate evaluator on `instruct_content` fields | HIGH |
| Phase graph viz | @xyflow/react reuse from Feature 1 (workflow as directed graph) | HIGH |
| Template CRUD | New `sop_templates` SQLite table | HIGH |
| Human gates | New `gate` action type with `status: 'awaiting_approval'` in `sop_role_state` | HIGH |
| Artifact schemas | Zod schema registry in DB (JSON column) | HIGH |

**NO NEW DEPENDENCIES NEEDED.** All enhancements use existing Zod, SQLite, and @xyflow/react.

### MetaGPT Patterns to Port

| MetaGPT Pattern | MC Equivalent | Gap |
|---|---|---|
| `Environment.publish_message()` | `sop_messages` INSERT + `eventBus.broadcast()` | Done |
| `Role._observe()` → watch filter | `WHERE cause_by IN (watches)` query | Done |
| `Role._react()` → by_order/react/plan_and_act | `reactMode` field on `SOPRole` | Done |
| `ActionNode` → validated JSON output | `ActionNodeDef` + `actionNodeToZodSchema()` | Done |
| `composed_phase` cycle loop | `code_review` template with `breakCondition` | Done |
| Parallel role execution | Sequential for-loop | **GAP -- needs Promise.allSettled** |
| Dynamic role creation during execution | Not supported | **GAP -- needs runtime role injection** |
| Cross-workflow dependencies | Not supported | **GAP -- needs workflow chaining** |

### Conditional Branching Schema (New)

```typescript
interface SOPBranch {
  condition: {
    type: 'field_equals' | 'field_contains' | 'field_gt' | 'custom_eval'
    field: string      // JSON path in instruct_content
    value: unknown     // comparison value
  }
  thenPhase: string    // role_id to activate
  elsePhase?: string   // optional fallback role_id
}
```

### Sources
- [MetaGPT GitHub](https://github.com/FoundationAgents/MetaGPT) -- Reference architecture for pub-sub + SOP patterns | HIGH
- [MetaGPT Paper (arXiv)](https://arxiv.org/html/2308.00352v6) -- Structured outputs, role definitions, environment model | HIGH
- [IBM MetaGPT Tutorial](https://www.ibm.com/think/tutorials/multi-agent-prd-ai-automation-metagpt-ollama-deepseek) -- PRD automation workflow example | MEDIUM
- [MetaGPT Multi-Agent Explained 2026](https://aiinovationhub.com/metagpt-multi-agent-framework-explained/) -- Current state overview | MEDIUM

---

## Feature 3: Debate/Consensus Rooms

### What Exists
`src/lib/conversation-engine.ts` already implements:
- `startDebate()` function with round-robin turns
- ChatDev `ComposedPhase` break condition pattern (keyword detection before and after turn)
- Configurable `DebateConfig`: participants, maxCycles, breakCondition (keyword/flag/empty)
- `detectConsensus()` keyword matcher
- Hop guard for runaway agent chains
- Budget enforcement per turn
- Memory integration (recall relevant memories, store conversation summary)
- Persona-aware system prompts via `buildSystemPrompt()`
- API route at `/api/debates/start`
- DB tables: `conversation_state`, `messages`

### What's Missing
- **Structured phases:** No formal propose/critique/rebut/vote phases. Current debate is free-form round-robin.
- **Voting mechanism:** No explicit vote collection/tallying. Consensus is keyword-only.
- **Confidence scoring:** Agents don't emit calibrated confidence scores (ConfMAD pattern).
- **Role assignments per round:** No distinct "proposer" vs "critic" vs "judge" roles within a debate.
- **Debate room UI:** No dedicated panel for viewing ongoing debates with phase indicators.
- **Multi-topic debates:** Single topic per conversation. No sub-topic forking.
- **Mediation agent:** No designated moderator who synthesizes positions and proposes compromise.

### Recommended Stack

| Component | Approach | Confidence |
|---|---|---|
| Structured phases | Enum: `propose`, `critique`, `rebut`, `synthesize`, `vote` | HIGH |
| Voting | New `debate_votes` SQLite table + tally query | HIGH |
| Confidence scores | JSON field on `messages.metadata` with `{ confidence: 0.0-1.0 }` | HIGH |
| Role assignment | Per-round role rotation in `DebateConfig` | HIGH |
| Debate room UI | React panel with phase progress indicator | HIGH |
| Mediation agent | Designated `judge` role that reads all positions and proposes synthesis | MEDIUM |

**NO NEW DEPENDENCIES NEEDED.** Structured debates are pure application logic.

### Debate Phase Protocol (New)

Based on ChatDev ComposedPhase + Free-MAD + ConfMAD research:

```
Phase 1: PROPOSE (each participant states position + confidence 0-1)
Phase 2: CRITIQUE (each participant critiques others, no conforming)
Phase 3: REBUT (each participant defends position, updates confidence)
Phase 4: SYNTHESIZE (designated judge or all agents propose merged position)
Phase 5: VOTE (binary accept/reject on synthesis, weighted by confidence)
```

Break conditions (checked between phases):
- Unanimous vote: all agents vote accept
- Supermajority: >66% weighted confidence-vote accept
- Max cycles reached
- Budget exceeded

### Sources
- [Patterns for Democratic Multi-Agent AI: Debate-Based Consensus](https://medium.com/@edoardo.schepis/patterns-for-democratic-multi-agent-ai-debate-based-consensus-part-2-implementation-2348bf28f6a6) -- Implementation patterns | MEDIUM
- [Free-MAD: Consensus-Free Multi-Agent Debate (OpenReview)](https://openreview.net/forum?id=46jbtZZWen) -- Explicit critique without conforming, max-score selection | MEDIUM
- [Debate or Vote: Which Yields Better Decisions (OpenReview)](https://openreview.net/pdf?id=iUjGNJzrF1) -- Comparative analysis | MEDIUM
- [Multi-Agent Debate Framework (Emergent Mind)](https://www.emergentmind.com/topics/multiagent-debate-framework) -- Weighted voting, confidence scoring | MEDIUM
- [ChatDev GitHub](https://github.com/OpenBMB/ChatDev) -- ComposedPhase + SimplePhase architecture | HIGH

---

## Feature 4: Deep Persona Simulation

### What Exists
`src/lib/persona-engine.ts` already implements:
- `BigFive` interface: openness, conscientiousness, extraversion, agreeableness, neuroticism (0-1 scale)
- `PersonaConfig`: age, nationality, education, goals, personality traits, preferences, beliefs, skills, style, behaviors, routines
- `MentalState`: emotions, goals, attention, context, lastUpdated
- `CognitiveState` for partial mental state updates
- 4 presets: analytical-engineer, creative-designer, cautious-reviewer, team-lead
- `buildSystemPrompt()` that combines soul_content + persona + mental state
- `updateMentalState()` for runtime emotion/goal updates
- `mergePersonaFragment()` for TinyTroupe-style overlay updates
- Storage: `agents.config` JSON column (no new tables)

### What's Missing
- **Emotional model (valence/arousal):** Current emotions are free-text strings. Need structured PAD (Pleasure-Arousal-Dominance) model.
- **Cognitive biases:** No explicit bias modeling. Need bias catalog with activation thresholds.
- **Trust scores:** No agent-to-agent trust tracking. Need pairwise trust matrix.
- **Emotional decay:** Mental state is static until explicitly updated. Need time-based decay toward baseline.
- **Interaction effects:** Big Five traits don't influence behavior selection or communication style adaptation.
- **Memory-emotion coupling:** Emotional state doesn't affect memory retrieval weighting.

### Recommended Stack

| Component | Approach | Confidence |
|---|---|---|
| Emotional model | PAD (Pleasure/Arousal/Dominance) 3-axis float, derived from Big Five baseline | HIGH |
| Cognitive biases | Bias catalog enum + activation function based on traits + context | MEDIUM |
| Trust scores | New `agent_trust_scores` SQLite table: `(from_agent_id, to_agent_id, trust_score, updated_at)` | HIGH |
| Emotional decay | Exponential decay function toward Big Five baseline on each tick | HIGH |
| Trait-behavior mapping | Lookup table: Big Five ranges -> communication style modifiers in system prompt | MEDIUM |
| Memory-emotion coupling | Emotional valence weights memory retrieval importance scores | LOW |

**NO NEW DEPENDENCIES NEEDED.** All persona enhancements are pure TypeScript logic + SQLite storage.

### TinyTroupe Patterns to Port

| TinyTroupe Pattern | MC Equivalent | Gap |
|---|---|---|
| Rich persona specification (age, nationality, education, goals, traits) | `PersonaConfig` interface | Done |
| Big Five personality traits (OCEAN) | `BigFive` interface (0-1 scale) | Done |
| Preset persona templates | `PERSONA_PRESETS` (4 presets) | Done |
| Mental state (emotions, goals, attention, context) | `MentalState` interface | Done |
| System prompt builder from persona | `buildSystemPrompt()` | Done |
| Overlay update pattern | `mergePersonaFragment()` | Done |
| Environment stimulus-response | Simulation engine tick | Partial |
| Inter-agent relationship tracking | Not implemented | **GAP -- needs trust matrix** |
| Cognitive bias modeling | Not implemented | **GAP -- needs bias catalog** |
| Emotional valence/arousal (PAD model) | Free-text emotions only | **GAP -- needs structured PAD** |
| Time-based emotional decay | Static until updated | **GAP -- needs decay function** |

### Emotional Model Schema (New)

```typescript
interface EmotionalState {
  pleasure: number    // -1 to +1 (negative = displeasure)
  arousal: number     // -1 to +1 (low = calm, high = excited)
  dominance: number   // -1 to +1 (low = submissive, high = dominant)
  baseline: { pleasure: number; arousal: number; dominance: number }
  decayRate: number   // 0-1, how fast emotions return to baseline
  lastUpdated: number
}

// Derived from Big Five:
// High Extraversion + High Agreeableness -> positive pleasure baseline
// High Neuroticism -> negative pleasure baseline, high arousal baseline
// High Conscientiousness -> high dominance baseline
```

### Cognitive Bias Catalog (New)

```typescript
type CognitiveBias =
  | 'confirmation_bias'      // Favor information confirming existing beliefs
  | 'anchoring_bias'         // Over-rely on first piece of information
  | 'availability_heuristic' // Judge probability by ease of recall
  | 'sunk_cost_fallacy'      // Continue because of prior investment
  | 'bandwagon_effect'       // Adopt beliefs because others hold them
  | 'dunning_kruger'         // Overestimate competence in unfamiliar domains
  | 'status_quo_bias'        // Prefer current state of affairs
  | 'recency_bias'           // Weight recent events more heavily

// Activation: bias fires when context matches + Big Five trait exceeds threshold
// Example: confirmation_bias activates when conscientiousness < 0.4 AND topic matches existing belief
```

### Sources
- [TinyTroupe GitHub (Microsoft)](https://github.com/microsoft/TinyTroupe) -- Reference persona simulation toolkit | HIGH
- [TinyTroupe Paper (arXiv)](https://arxiv.org/html/2507.09788v1) -- Formal description of persona model | HIGH
- [Big Five + Emotions Relationship (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12758648/) -- OCEAN to emotional expression mapping | MEDIUM
- [Big Five + LLM Risk-Taking (ACL 2025)](https://aclanthology.org/2025.findings-acl.1085.pdf) -- How personality traits shape LLM behavior | MEDIUM
- [Big Five + Negotiation (arXiv)](https://arxiv.org/html/2506.15928v1) -- Agreeableness/Extraversion drive collaboration | MEDIUM

---

## Feature 5: Auto-Hiring / Self-Scaling

### What Exists
- `src/app/api/workload/route.ts`: Full workload signal API with queue depth, agent saturation, error rate, completion rate, throttle/shed/pause recommendations
- `src/app/api/spawn/route.ts`: Agent spawn API via OpenClaw CLI
- `src/lib/agent-templates.ts`: 7 agent archetypes (orchestrator, developer, specialist-dev, reviewer, researcher, content-creator, security-auditor)
- `src/lib/simulation-engine.ts`: Tick-based agent loop that processes idle agents
- Threshold configuration via environment variables (`MC_WORKLOAD_*`)

### What's Missing
- **Auto-scale decision engine:** No component that reads workload signals and decides when to hire/fire.
- **Hire request protocol:** No formal event type for "agent requests more help."
- **Scale-down logic:** No idle detection + graceful termination.
- **Template selection heuristic:** No logic to match queue task types to template archetypes.
- **Fleet size constraints:** No min/max agent count configuration.
- **Cooldown periods:** No hysteresis to prevent rapid scale-up/scale-down oscillation.
- **Cost-aware scaling:** No budget consideration in scaling decisions.

### Recommended Stack

| Component | Approach | Confidence |
|---|---|---|
| Scale controller | New `src/lib/auto-scaler.ts` class (lazy singleton like SimulationEngine) | HIGH |
| Decision metrics | Reuse existing `buildQueueMetrics()` + `buildAgentMetrics()` + `buildCapacityMetrics()` from workload API | HIGH |
| Hire request event | New EventBus type: `'scale.hire_requested'` | HIGH |
| Scale-down detection | Idle duration threshold (configurable via env) + graceful drain | HIGH |
| Template matching | Rule-based: task tags -> template type lookup | MEDIUM |
| Fleet constraints | `MC_AUTOSCALE_MIN_AGENTS`, `MC_AUTOSCALE_MAX_AGENTS` env vars | HIGH |
| Cooldown | Timestamp tracking: `lastScaleUp`, `lastScaleDown` with configurable cooldown | HIGH |
| Budget gate | Reuse `checkAgentBudget()` before spawning | HIGH |

**NO NEW DEPENDENCIES NEEDED.** Auto-scaling is pure orchestration logic.

### Auto-Scale Decision Algorithm

```
Every tick (30s default):
  1. Read workload signals (queue_depth, agent_saturation, error_rate)
  2. Compute desired_agents = ceil(queue.total_pending / TASKS_PER_AGENT)
  3. Clamp to [MIN_AGENTS, MAX_AGENTS]
  4. If desired > current_online AND cooldown_elapsed:
       a. Select template based on highest-priority task type in queue
       b. Check budget for new agent
       c. Spawn via /api/spawn
       d. Record lastScaleUp timestamp
  5. If desired < current_online AND any agent idle > IDLE_THRESHOLD:
       a. Select most-idle agent with no in-progress tasks
       b. Gracefully terminate (complete current task, then offline)
       c. Record lastScaleDown timestamp
```

### Key Configuration Parameters

| Env Variable | Default | Purpose |
|---|---|---|
| `MC_AUTOSCALE_ENABLED` | `false` | Feature flag (opt-in, like simulation) |
| `MC_AUTOSCALE_MIN_AGENTS` | `1` | Never scale below this |
| `MC_AUTOSCALE_MAX_AGENTS` | `10` | Never scale above this |
| `MC_AUTOSCALE_TASKS_PER_AGENT` | `5` | Target task-to-agent ratio |
| `MC_AUTOSCALE_IDLE_THRESHOLD_MS` | `300000` | 5min idle before scale-down eligible |
| `MC_AUTOSCALE_COOLDOWN_MS` | `120000` | 2min between scale events |
| `MC_AUTOSCALE_TICK_MS` | `30000` | Check interval |

### Sources
- [AI Agent Orchestration in 2026 (Kanerika)](https://kanerika.com/blogs/ai-agent-orchestration/) -- Scale and coordination patterns | MEDIUM
- [Predictable Scaling with Queue Length (ThinhDA)](https://thinhdanggroup.github.io/predictive-scaling/) -- Queue-based scaling math | MEDIUM
- [KEDA](https://keda.sh/) -- Kubernetes event-driven autoscaling reference architecture | MEDIUM
- [Deploying AI Agents at Scale (RunPod)](https://www.runpod.io/articles/guides/deploying-ai-agents-at-scale-building-autonomous-workflows) -- Agent infrastructure patterns | LOW
- [Amazon SQS Scaling Policy](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-using-sqs-queue.html) -- Queue depth to instance count formula | HIGH

---

## Feature 6: @Mention Team Chat

### What Exists
- `src/app/api/chat/messages/route.ts`: Full chat message CRUD with:
  - `from_agent`, `to_agent` fields on `messages` table
  - Coordinator agent forwarding to OpenClaw gateway
  - Injection scanning on forwarded messages
  - SSE broadcast via `eventBus.broadcast('chat.message', ...)`
  - Conversation-based threading (`conversation_id`)
  - Activity logging and notification creation for recipients
- `src/lib/event-bus.ts`: `chat.message` event type
- `src/lib/coordinator-routing.ts`: Coordinator agent delivery target resolution
- `src/app/api/hermes/route.ts`: Hermes agent hook integration

### What's Missing
- **@mention parser:** No extraction of `@agent_name`, `@all`, `@team:name` from message content.
- **Multi-recipient routing:** Current `to_agent` is single string. Need array or comma-separated support.
- **Team grouping:** No team/group concept in agent model. Need `agent_teams` table or `team` field on agents.
- **@all broadcast:** No mechanism to fan-out a message to all agents in workspace.
- **Mention autocomplete UI:** No typeahead for `@` in chat input.
- **Read receipts for mentions:** No tracking of whether mentioned agent has seen/processed the message.
- **Mention notifications:** Current notification only fires for `to_agent`. Need mention-based notifications.

### Recommended Stack

| Component | Approach | Confidence |
|---|---|---|
| Mention parser | Regex: `/@(\w+(?::\w+)?)/g` extracting agent names and team prefixes | HIGH |
| Multi-recipient | New `message_recipients` join table OR comma-separated `to_agent` | HIGH |
| Team grouping | New `teams` + `team_members` SQLite tables | HIGH |
| @all broadcast | Fan-out: query all active agents in workspace, create notification per agent | HIGH |
| Autocomplete UI | Client-side filter against Zustand agent list, triggered by `@` keypress | HIGH |
| Read receipts | New `mention_reads` table: `(message_id, agent_id, read_at)` | MEDIUM |
| Mention notifications | Extend `createNotification()` to fire for each mentioned agent | HIGH |

**NO NEW DEPENDENCIES NEEDED.** Mention routing is parsing + DB queries.

### Mention Syntax

```
@agent_name    -> Route to specific agent by name (case-insensitive lookup)
@all           -> Broadcast to all agents in workspace
@team:backend  -> Route to all members of "backend" team
@team:leads    -> Route to all members of "leads" team
@human         -> Route to human operators (notification only, no agent forwarding)
```

### Mention Parser Implementation

```typescript
interface ParsedMention {
  type: 'agent' | 'all' | 'team' | 'human'
  target: string        // agent name, team name, or 'all'/'human'
  raw: string           // original match including @
  startIndex: number
  endIndex: number
}

function parseMentions(content: string): ParsedMention[] {
  const regex = /@(all|human|team:(\w+)|(\w[\w.-]*))/gi
  const mentions: ParsedMention[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    if (match[1].toLowerCase() === 'all') {
      mentions.push({ type: 'all', target: 'all', raw: match[0], startIndex: match.index, endIndex: match.index + match[0].length })
    } else if (match[1].toLowerCase() === 'human') {
      mentions.push({ type: 'human', target: 'human', raw: match[0], startIndex: match.index, endIndex: match.index + match[0].length })
    } else if (match[2]) {
      mentions.push({ type: 'team', target: match[2], raw: match[0], startIndex: match.index, endIndex: match.index + match[0].length })
    } else if (match[3]) {
      mentions.push({ type: 'agent', target: match[3], raw: match[0], startIndex: match.index, endIndex: match.index + match[0].length })
    }
  }
  return mentions
}
```

### Sources
- [Scalable Multi-Agent Chat Using @Mentions (n8n)](https://n8n.io/workflows/3473-scalable-multi-agent-chat-using-mentions/) -- @mention routing pattern for agent systems | MEDIUM
- [Implementing Group Chat with Redis Pub/Sub in Next.js 15](https://getstream.io/blog/redis-group-chat/) -- Pub/sub broadcast pattern | MEDIUM
- [Building Next.js for an Agentic Future](https://nextjs.org/blog/agentic-future) -- Next.js agent integration patterns | MEDIUM

---

## Recommended Stack (Consolidated)

### Core Technologies (Already Installed)

| Technology | Version | Purpose | Why It Stays |
|---|---|---|---|
| Next.js | ^16.1.6 | Full-stack framework | App Router + API routes for all features |
| React | ^19.0.1 | UI framework | Custom nodes, panels, chat UI |
| TypeScript | ^5.7.2 | Type safety | All new engines and schemas |
| SQLite (better-sqlite3) | ^12.6.2 | Persistence | All new tables for trust, teams, votes, templates |
| Zustand | ^5.0.11 | State management | Canvas state, chat state, debate state |
| @xyflow/react | ^12.10.0 | Spatial canvas | Agent topology + workflow DAG visualization |
| Zod | ^4.3.6 | Validation | Workflow artifact schemas, debate configs |
| Tailwind CSS | ^3.4.17 | Styling | All new panels and components |

### New Dependencies (Only 1 Required)

| Library | Version | Purpose | Install Command |
|---|---|---|---|
| `@dagrejs/dagre` | ^2.0.4 | Auto-layout for directed graph nodes | `pnpm add @dagrejs/dagre` |

### New Dev Dependencies (0 Required)

No new dev dependencies needed.

### Dependencies to REMOVE

| Library | Reason |
|---|---|
| `reactflow` (^11.11.4) | Legacy package -- `@xyflow/react` (^12.10.0) is already installed as replacement. Keeping both is dead weight. |

---

## Installation

```bash
# New dependency (only 1)
pnpm add @dagrejs/dagre

# Remove legacy duplicate
pnpm remove reactflow

# Optional: bump @xyflow/react to latest patch
pnpm add @xyflow/react@^12.10.1
```

### Type Declarations

`@dagrejs/dagre` ships its own TypeScript types. No `@types/` package needed.

---

## New SQLite Tables Required

| Table | Feature | Columns |
|---|---|---|
| `sop_templates` | Feature 2 | `id`, `name`, `description`, `template_json`, `created_by`, `created_at`, `updated_at`, `workspace_id` |
| `debate_votes` | Feature 3 | `id`, `conversation_id`, `round`, `agent_id`, `vote` (accept/reject), `confidence`, `rationale`, `created_at` |
| `agent_trust_scores` | Feature 4 | `from_agent_id`, `to_agent_id`, `trust_score` (0-1), `interaction_count`, `updated_at`, `workspace_id` |
| `teams` | Feature 6 | `id`, `name`, `description`, `created_at`, `workspace_id` |
| `team_members` | Feature 6 | `team_id`, `agent_id`, `role`, `joined_at` |
| `mention_reads` | Feature 6 | `message_id`, `agent_id`, `read_at` |
| `autoscale_events` | Feature 5 | `id`, `event_type` (scale_up/scale_down), `agent_id`, `template_type`, `reason`, `metrics_snapshot`, `created_at`, `workspace_id` |

All tables follow existing MC convention: INTEGER PRIMARY KEY, workspace_id foreign key, unix timestamp columns.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|---|---|---|
| `@dagrejs/dagre` | `elkjs` | When you need constraint-based layout, compound nodes, or port-level routing. ELK is async and 3x heavier but more configurable. |
| CSS `offset-path` animation | `motion` (framer-motion) | When you need spring physics, gesture handling, or layout animations beyond edge particles. Adds ~30KB. |
| SQLite tables for templates | File-based YAML templates | When deploying as Git-managed config (like MetaGPT's YAML files). DB is better for CRUD UI. |
| Regex mention parser | `@mentions/parser` npm package | When you need @mention parsing for multiple platforms (Slack, Discord, etc.). Overkill for single-platform use. |
| `reagraph` (3D) | `@xyflow/react` (2D) | For 3D visualization of large agent networks. Already installed but not needed for 2D spatial canvas. |
| Zustand canvas store | React Flow internal store | When you don't need to sync canvas state with other UI panels. MC needs cross-panel sync so Zustand is correct. |

## What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| `reactflow` (v11) | Legacy package, `@xyflow/react` v12 already installed | `@xyflow/react` ^12.10.0 |
| `framer-motion` / `motion` | 30KB for edge animations that CSS `offset-path` handles natively | CSS `@keyframes` + `offset-path` |
| `redis` / `ioredis` | Project uses SQLite + in-memory caching, adding Redis breaks single-binary deployment | SQLite + EventBus |
| `socket.io` | SSE (already implemented via EventBus) is sufficient for unidirectional server->client events. `ws` is already installed for bidirectional needs. | Existing SSE + `ws` |
| Icon libraries (`lucide-react`, `heroicons`, etc.) | CLAUDE.md convention: "No icon libraries -- use raw text/emoji in components" | Text/emoji |
| `tailwindcss` v4 | Project is on Tailwind v3. Upgrading would break unlayered CSS vs `@layer utilities` | `tailwindcss` ^3.4.17 |
| `npm` / `yarn` | Project uses pnpm exclusively. Mixing package managers corrupts lockfile. | `pnpm` |
| `d3-hierarchy` for layout | Requires single root node. Agent topology has multiple roots (teams, orphan agents). | `@dagrejs/dagre` |

---

## Stack Patterns by Feature

**If adding spatial visualization (Feature 1):**
- Use `@xyflow/react` with custom node types + `@dagrejs/dagre` for auto-layout
- Integrate with Zustand via dedicated canvas store slice
- Connect to SSE events for real-time node/edge updates
- Reuse existing `topology-panel.tsx` as foundation (refactor, don't rewrite)

**If adding workflow engine enhancements (Feature 2):**
- Extend existing `sop-engine.ts` (don't replace)
- Add `Promise.allSettled()` for parallel role execution
- Add conditional branching via JSON predicates on `instruct_content`
- Reuse @xyflow/react to visualize workflow DAG (same canvas, different node types)

**If adding debate rooms (Feature 3):**
- Extend existing `conversation-engine.ts` `startDebate()` function
- Add structured phase enum (propose/critique/rebut/synthesize/vote)
- Add `debate_votes` table for explicit vote tracking
- Reuse existing `messages` table with new `metadata.confidence` field

**If adding deep persona simulation (Feature 4):**
- Extend existing `persona-engine.ts` (don't replace)
- Add PAD emotional model as structured replacement for free-text emotions
- Add `agent_trust_scores` table for pairwise trust
- Add cognitive bias catalog as TypeScript enum + activation functions

**If adding auto-scaling (Feature 5):**
- Create new `auto-scaler.ts` following `SimulationEngine` lazy-singleton pattern
- Reuse existing workload API metrics functions (extract from route handler)
- Reuse existing agent templates for spawn decisions
- Add `AUTOSCALE_ENABLED` feature flag (opt-in, same pattern as `SIMULATION_ENABLED`)

**If adding @mention chat (Feature 6):**
- Extend existing `POST /api/chat/messages` with mention parsing middleware
- Add `teams`/`team_members` tables for `@team:name` routing
- Extend existing `eventBus.broadcast('chat.message', ...)` to fan-out
- Add autocomplete component to existing chat input

---

## Version Compatibility

| Package A | Compatible With | Notes |
|---|---|---|
| `@xyflow/react@^12.10.0` | `react@^19.0.1` | Confirmed compatible via Zustand update (2025-01) |
| `@xyflow/react@^12.10.0` | `zustand@^5.0.11` | React Flow uses Zustand internally; same version compatible |
| `@dagrejs/dagre@^2.0.4` | `@xyflow/react@^12.10.0` | React Flow docs show dagre integration examples |
| `zod@^4.3.6` | `typescript@^5.7.2` | Zod 4 requires TS 5.5+; project uses 5.7 |
| `better-sqlite3@^12.6.2` | `node@>=22` | Native addon, project already enforces Node 22+ |
| `next@^16.1.6` | `react@^19.0.1` | Next.js 16 requires React 19 |

---

## New EventBus Event Types Required

```typescript
// Add to EventType union in src/lib/event-bus.ts
| 'sop.workflow.started'
| 'sop.workflow.completed'
| 'sop.action.completed'
| 'debate.started'
| 'debate.vote.cast'
| 'debate.consensus.reached'
| 'persona.emotion.updated'
| 'persona.trust.updated'
| 'scale.hire_requested'
| 'scale.agent_spawned'
| 'scale.agent_terminated'
| 'chat.mention'
```

---

## Summary

| Feature | New Deps | New Tables | Extends Existing | Confidence |
|---|---|---|---|---|
| 1. Spatial 2D Visualization | `@dagrejs/dagre` | 0 | `topology-panel.tsx`, Zustand store | HIGH |
| 2. Workflow Engine | 0 | 1 (`sop_templates`) | `sop-engine.ts` | HIGH |
| 3. Debate/Consensus | 0 | 1 (`debate_votes`) | `conversation-engine.ts` | HIGH |
| 4. Deep Persona | 0 | 1 (`agent_trust_scores`) | `persona-engine.ts` | HIGH |
| 5. Auto-Scaling | 0 | 1 (`autoscale_events`) | `simulation-engine.ts`, `workload` API | HIGH |
| 6. @Mention Chat | 0 | 3 (`teams`, `team_members`, `mention_reads`) | `chat/messages` API, `event-bus.ts` | HIGH |
| **TOTAL** | **1 new, 1 removed** | **7 new tables** | **6 existing engines/APIs** | |

**Net dependency change: -1** (add dagre, remove legacy reactflow).

---

*Stack research for: AI multi-agent orchestration platform (Phase 6 expansion)*
*Researched: 2026-03-15*
