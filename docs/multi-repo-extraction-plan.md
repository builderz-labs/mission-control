# Multi-Repo Feature Extraction Plan for Mission Control

## Source Repositories Analyzed

| Repo | Stars | Language | What We Extract |
|------|-------|----------|----------------|
| AI Town (a16z-infra) | 9,538 | TypeScript | Memory architecture, conversation lifecycle, decision loop |
| MetaGPT (geekan) | 65,160 | Python | SOP engine, pub-sub routing, output validation, task DAG |
| ChatDev (OpenBMB) | 31,635 | Python | Debate/consensus, composed phase loops, experiential learning |
| TinyTroupe (Microsoft) | 7,322 | Python | Rich persona model, cognitive state, stimulus-response |
| Agentchattr (bcurts) | 860 | Python | Loop guard, epoch-based sync |

All source code is MIT-licensed. All patterns are reimplemented in TypeScript for MC's Next.js + SQLite stack. Zero Python dependencies.

---

## MC Feature Gap Analysis

What MC already has (DO NOT rebuild):
- 96 API routes, 30 panels, 27 tables
- Agent CRUD with 15+ endpoints, soul_content, config JSON
- Chat with @mentions, conversations, SSE broadcast
- Workflow pipeline framework (templates, runs, tracking)
- Token/cost tracking with per-model pricing
- Virtual office with zone-based layout, movement animation
- SSE + WebSocket + smart polling (3-tier real-time)
- Intervention system (ROLLBACK, HANDOFF, FORCE_SYNC)
- Audit logging, notifications, alerts

What MC is missing (BUILD these):

| Gap | Source Repo | Priority |
|-----|-----------|----------|
| Direct LLM integration (MC reads session logs, never calls LLMs) | Agent Office | P0 |
| Stanford memory architecture (observe/reflect/relate) | AI Town | P0 |
| Rich persona model (Big Five, beliefs, emotional state) | TinyTroupe | P1 |
| Conversation lifecycle (start/continue/leave with LLM) | AI Town + ChatDev | P1 |
| Structured workflow SOP with artifact validation | MetaGPT | P1 |
| Debate/consensus mechanism | ChatDev | P2 |
| Agent decision engine (autonomous simulation loop) | AI Town | P2 |
| LLM output validation and repair pipeline | MetaGPT | P1 |
| Anti-runaway loop guard for agent-to-agent chains | Agentchattr | P1 |
| Experiential learning (shortcut extraction from past sessions) | ChatDev | P3 |

---

## Phase 0: LLM Integration Layer (Foundation)

**Source**: Agent Office `InferenceAdapter` pattern
**Why first**: Every subsequent phase requires calling an LLM. MC currently has zero LLM call capability.

### New files

**`src/lib/llm/inference-adapter.ts`** — Provider-agnostic interface:

```typescript
interface CompletionRequest {
  model: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  temperature?: number
  maxTokens?: number
  responseFormat?: 'text' | 'json'
}

interface CompletionResponse {
  text: string
  tokenCount: { input: number; output: number }
  cost: number
  latencyMs: number
  model: string
}

interface InferenceAdapter {
  readonly provider: string
  complete(request: CompletionRequest): Promise<CompletionResponse>
  embed?(text: string): Promise<number[]>
}
```

**`src/lib/llm/adapters/anthropic.ts`** — Claude adapter (primary):
- Uses `@anthropic-ai/sdk` (already in the ecosystem via Claude Code)
- Maps to `claude-haiku-4-5` (fast/cheap), `claude-sonnet-4-5` (standard), `claude-opus-4-6` (complex)

**`src/lib/llm/adapters/openai-compatible.ts`** — OpenAI/Ollama adapter:
- Raw `fetch` to any OpenAI-compatible endpoint (same pattern as AI Town's `convex/util/llm.ts`)
- Supports local Ollama at `http://localhost:11434/v1`

**`src/lib/llm/router.ts`** — Tiered model routing:

```typescript
type TaskTier = 'fast' | 'standard' | 'complex'

// Routing rules:
// fast: status updates, simple replies, movement decisions → haiku / llama3.2
// standard: conversations, basic analysis → sonnet / gpt-4o-mini
// complex: architecture, debugging, persona simulation → opus / gpt-4o

function selectTier(taskType: string): TaskTier
function getAdapter(tier: TaskTier): InferenceAdapter
```

**`src/lib/llm/output-repair.ts`** — MetaGPT's 4-step repair pipeline:

```typescript
// Step 1: Extract content between [CONTENT]...[/CONTENT] tags
// Step 2: Repair common JSON syntax (trailing commas, single quotes)
// Step 3: Parse JSON
// Step 4: Validate against Zod schema, throw structured error on failure
function repairAndParse<T>(raw: string, schema: z.ZodType<T>): T
```

**API route**: `POST /api/llm/complete` — server-side LLM proxy with:
- Rate limiting per agent per minute
- Token usage recording to existing `token_usage` table
- Budget enforcement (configurable per-agent daily cap)

**Config**: Environment variables:
- `LLM_PROVIDER` = `anthropic` | `openai` | `ollama`
- `LLM_API_KEY` = API key
- `LLM_BASE_URL` = custom endpoint (for Ollama/proxies)
- `LLM_BUDGET_PER_AGENT_DAY` = max cost in dollars (default: 5)

**New dependency**: `@anthropic-ai/sdk` (or use raw `fetch` for zero-dep)

**Tests**: 15+ unit tests (adapter mocks, router logic, repair pipeline, budget enforcement)

---

## Phase 1: Agent Memory System

**Source**: AI Town `convex/agent/memory.ts` + TinyTroupe `tinytroupe/agent/memory.py`
**Depends on**: Phase 0 (LLM calls for importance scoring and reflection generation)

### Concept extraction

**From AI Town** (the Stanford Generative Agents paper):
- 3 memory types: observation, reflection, relationship
- Composite retrieval scoring: `normalize(relevance) + normalize(importance) + normalize(recency)`
- Recency decay: `0.99^hours_since_access`
- Importance scoring: LLM rates 0-9 "poignancy" per memory
- Reflection trigger: cumulative importance > threshold → generate 3 high-level insights
- Embedding cache by text hash

**From TinyTroupe**:
- Dual memory: episodic (raw events) + semantic (consolidated knowledge)
- Episodic windowing: fixed prefix (first N) + lookback (last N) for context assembly
- Episode consolidation: LLM summarizes recent episodic events into semantic memory at episode boundaries

### MC adaptation

**New migration** (`039_agent_memories.sql`):

```sql
CREATE TABLE agent_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('observation','reflection','relationship')),
  description TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 0,
  last_access INTEGER NOT NULL DEFAULT (unixepoch()),
  related_agent_id INTEGER,
  source_memory_ids TEXT,
  workspace_id INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE agent_memory_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id INTEGER NOT NULL REFERENCES agent_memories(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,
  embedding_model TEXT NOT NULL,
  text_hash TEXT NOT NULL UNIQUE
);

CREATE INDEX idx_mem_agent_type ON agent_memories(agent_id, type);
CREATE INDEX idx_mem_importance ON agent_memories(agent_id, importance DESC);
CREATE INDEX idx_mem_recency ON agent_memories(agent_id, last_access DESC);
```

**New file**: `src/lib/agent-memory.ts`

```typescript
// Core operations:
observe(agentId, description, relatedAgentId?): Promise<number>
  // 1. Store as 'observation' memory
  // 2. Call LLM to rate importance 0-9 (fast tier)
  // 3. Generate embedding, cache by text hash
  // 4. Check reflection trigger (cumulative importance > 500)

recall(agentId, query, topK = 5): Promise<Memory[]>
  // 1. Generate query embedding
  // 2. Over-fetch 10x by relevance (FTS5 or cosine similarity)
  // 3. Re-rank by composite score: relevance + importance + recency
  // 4. Update last_access on returned memories
  // 5. Return top-K

reflect(agentId): Promise<void>
  // 1. Fetch recent memories since last reflection
  // 2. Ask LLM: "Given these memories, what 3 high-level insights can you infer?"
  // 3. Store each insight as 'reflection' type with source_memory_ids
  // 4. Rate importance of each reflection

recordRelationship(agentId, targetAgentId, description): Promise<void>
  // Store/update relationship memory between two agents

consolidateEpisode(agentId, episodeMemoryIds): Promise<void>
  // TinyTroupe pattern: summarize a batch of observations into one semantic memory
```

**Embedding strategy**: FTS5 for text similarity as default (zero dependency). Optional vector embeddings via the Phase 0 adapter's `embed()` method when `LLM_PROVIDER` supports it.

**Sovereign memory preserved**: Existing `sovereign_memory` table and API unchanged. New memory system is additive.

**API routes**:
- `POST /api/agents/[id]/memory/observe` — record observation
- `POST /api/agents/[id]/memory/recall` — query memories
- `POST /api/agents/[id]/memory/reflect` — trigger reflection
- `GET /api/agents/[id]/memory/timeline` — memory timeline view

**Tests**: 25+ unit tests covering observe, recall scoring, reflection trigger, embedding cache, consolidation

---

## Phase 2: Persona Engine

**Source**: TinyTroupe `TinyPerson` persona model + mental state tracking
**Depends on**: Phase 0 (LLM calls for emotional state updates)

### Concept extraction

**From TinyTroupe**:
- Rich persona config: Big Five personality traits, beliefs, preferences, skills, behaviors, relationships
- Mental state: datetime, location, context, goals, attention, emotions (free-text, LLM-maintained)
- Cognitive state returned with every action: `{ goals, context, attention, emotions }`
- Persona injected as full JSON into system prompt (not just a text description)
- Fragment merging: overlay partial persona updates onto a base persona

### MC adaptation

MC already has `soul_content` (free-text SOUL.md) and `config` (JSON) on the agents table. Rather than adding new columns, we extend the existing `config` JSON with a structured `persona` section.

**New file**: `src/lib/persona-engine.ts`

```typescript
interface PersonaConfig {
  // Identity
  age?: number
  nationality?: string
  education?: string
  long_term_goals?: string[]

  // Personality (TinyTroupe Big Five)
  personality?: {
    traits: string[]  // ["methodical", "skeptical", "detail-oriented"]
    big_five: {
      openness: number       // 0-1
      conscientiousness: number
      extraversion: number
      agreeableness: number
      neuroticism: number
    }
  }

  // Behavioral
  preferences?: { interests: string[]; likes: string[]; dislikes: string[] }
  beliefs?: string[]
  skills?: string[]
  style?: string  // Communication style
  behaviors?: { general: string[]; routines?: Record<string, string[]> }
}

interface MentalState {
  emotions: string        // Free-text, LLM-maintained each turn
  goals: string           // Current short-term goals
  attention: string | null // What agent is focused on
  context: string[]       // Current situational context
  lastUpdated: number
}

// Core operations:
buildSystemPrompt(agent: Agent): string
  // 1. Start with soul_content (existing SOUL.md)
  // 2. Inject persona config as structured JSON (TinyTroupe pattern)
  // 3. Inject current mental state (emotions, goals, attention)
  // 4. Result: rich prompt that influences LLM behavior

updateMentalState(agentId: number, cognitiveState: CognitiveState): void
  // Store updated emotions/goals/attention after each agent action
  // Persisted in agent config JSON under config.mental_state

mergePersonaFragment(agentId: number, fragment: Partial<PersonaConfig>): void
  // TinyTroupe fragment pattern: overlay partial updates onto existing persona
```

**No new tables**. Persona lives in `agents.config` JSON. Mental state in `agents.config.mental_state`. This avoids schema changes while keeping the data co-located with the agent.

**UI**: Extend existing `config-tab.tsx` in agent detail with a "Persona" section:
- Big Five sliders (0-1 range)
- Traits, beliefs, skills as tag inputs
- Emotion display (read-only, updated by simulation)
- Preset templates: "Analytical Engineer", "Creative Designer", "Cautious Reviewer"

**Tests**: 15+ unit tests (prompt building, mental state updates, fragment merging, preset templates)

---

## Phase 3: Conversation Lifecycle + Debate

**Source**: AI Town `conversation.ts` + ChatDev `phase.py` consensus mechanism
**Depends on**: Phase 0 (LLM), Phase 1 (memory recall for context), Phase 2 (persona for system prompts)

### Concept extraction

**From AI Town** — 3-phase conversation:
1. **Start**: Fetch both agents' identities, retrieve related memories via recall, inject personality + goals + past conversation context, generate opener
2. **Continue**: Load full message history, inject memories and personality, generate response (200 chars max), check limits (8 messages or 10 minutes)
3. **Leave**: Generate farewell, store memory of entire conversation, trigger reflection if importance threshold met

**From ChatDev** — Consensus detection:
- `<INFO>` keyword on last line signals consensus reached
- 3-level termination cascade: keyword match → turn limit → reflection fallback
- ComposedPhase pattern: loop of sub-phases with `breakCycle()` check before AND after each sub-phase

**From Agentchattr** — Anti-runaway loop guard:
- Per-channel hop counter incremented on each agent-to-agent message
- Max hops (default 4) → auto-pause → requires human message to reset
- Simple, effective, 30 lines of logic

### MC adaptation

Extend existing chat system (no replacement).

**New file**: `src/lib/conversation-engine.ts`

```typescript
interface ConversationConfig {
  maxMessages: number      // default 8 (AI Town)
  maxDurationMs: number    // default 600000 (10 min)
  consensusKeyword: string // default "<DONE>" (ChatDev <INFO> pattern)
  maxHops: number          // default 4 (Agentchattr loop guard)
  needReflect: boolean     // ChatDev reflection fallback
}

// Core operations:
startConversation(initiatorId, targetId, topic): Promise<string>
  // 1. Build system prompts for both agents (Phase 2)
  // 2. Recall relevant memories for both agents (Phase 1)
  // 3. Generate opener via LLM (Phase 0)
  // 4. Store message via existing /api/chat/messages
  // 5. Broadcast via SSE (existing eventBus)
  // 6. Return conversation_id

continueConversation(conversationId, responderId): Promise<boolean>
  // 1. Load message history for conversation
  // 2. Check limits (message count, duration, hop counter)
  // 3. If hop limit reached: auto-pause, return false
  // 4. Recall memories relevant to recent messages
  // 5. Generate response via LLM with persona-aware prompt
  // 6. Check for consensus keyword in response
  // 7. If consensus: extract conclusion, store, return false
  // 8. Store message, increment hop counter, return true (continue)

leaveConversation(agentId, conversationId): Promise<void>
  // 1. Generate farewell message via LLM
  // 2. Store message
  // 3. Summarize entire conversation via LLM
  // 4. Store summary as observation memory (Phase 1)
  // 5. Check reflection trigger
```

**Debate mode** (ChatDev ComposedPhase adaptation):

```typescript
interface DebateConfig extends ConversationConfig {
  participants: number[]   // 2+ agent IDs
  maxCycles: number        // ComposedPhase cycleNum (default 3)
  breakCondition: BreakCondition
}

type BreakCondition =
  | { type: 'keyword'; keyword: string }    // "<DONE> Consensus: ..."
  | { type: 'flag'; field: string; value: boolean }
  | { type: 'empty'; field: string }

startDebate(topic, participantIds, config): Promise<string>
  // Round-robin speakers
  // Check break condition BEFORE and AFTER each turn (ChatDev pattern)
  // On consensus: extract conclusion from keyword suffix
  // On max cycles: trigger reflection fallback (CEO + Counselor summarize)
```

**API routes**:
- `POST /api/conversations/start` — initiate LLM conversation between two agents
- `POST /api/conversations/[id]/continue` — generate next response
- `POST /api/conversations/[id]/leave` — end conversation with memory storage
- `POST /api/debates/start` — multi-agent debate with consensus detection
- `GET /api/debates/[id]` — debate status and transcript

**New migration** (`040_conversation_lifecycle.sql`):

```sql
ALTER TABLE messages ADD COLUMN conversation_phase TEXT
  CHECK(conversation_phase IN ('start','continue','leave'));

CREATE TABLE conversation_state (
  conversation_id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','consensus','timeout','paused')),
  hop_count INTEGER DEFAULT 0,
  consensus TEXT,
  started_at INTEGER NOT NULL,
  max_messages INTEGER DEFAULT 8,
  max_duration_ms INTEGER DEFAULT 600000
);
```

**Tests**: 20+ unit tests (lifecycle phases, consensus detection, hop guard, reflection fallback, debate round-robin)

---

## Phase 4: Workflow SOP Engine

**Source**: MetaGPT SOP engine + ChatDev ChatChain
**Depends on**: Phase 0 (LLM), Phase 2 (persona for role prompts), Phase 3 (conversation for role interactions)

### Concept extraction

**From MetaGPT** — the 5 key patterns:

1. **Pub-sub SOP**: Roles declare what they `watch`. Pipeline emerges from subscriptions, not explicit phase lists.
   - Role A produces artifact of type X → Role B watches for type X → triggers automatically.

2. **Profile-Goal-Constraint roles**: Each role = `{ profile, goal, constraints, reactMode }`.
   System prompt auto-generated: `"You are a {profile}, named {name}, your goal is {goal}."`

3. **Dual-content messages**: Each message carries `content` (natural language) + `instructContent` (structured JSON validated by Zod schema).

4. **3 react modes**:
   - `by_order`: Execute actions sequentially (fixed SOP — safest, most predictable)
   - `react`: LLM picks which action to take (flexible, higher risk)
   - `plan_and_act`: LLM generates task DAG, then executes topologically

5. **LLM output validation**: ActionNode trees define expected output structure. Dynamic Zod schemas validate LLM output. 4-step repair pipeline on failure.

**From ChatDev** — ComposedPhase loops:
- SimplePhase = one two-agent conversation
- ComposedPhase = loop of SimplePhases with cycle limit and break condition
- Code review loop: Reviewer↔Programmer cycle up to 3 times, breaks on `"<INFO> Finished"`

### MC adaptation

MC already has `workflow_templates`, `workflow_pipelines`, and `pipeline_runs` tables. Extend these rather than replacing.

**New file**: `src/lib/sop-engine.ts`

```typescript
// MetaGPT-style role definition (stored in workflow_templates)
interface SOPRole {
  id: string
  profile: string         // "Product Manager"
  goal: string            // "Create a comprehensive PRD"
  constraints: string     // "Must include success metrics"
  reactMode: 'by_order' | 'react' | 'plan_and_act'
  actions: SOPAction[]    // Ordered action list
  watches: string[]       // Action types this role subscribes to
}

// MetaGPT-style action with output schema
interface SOPAction {
  type: string            // "WritePRD", "WriteDesign", etc.
  outputSchema: ActionNodeDef[]  // Zod schema tree for validation
  prompt: string          // Instructions for the LLM
  tier: TaskTier          // LLM tier: fast/standard/complex
}

interface ActionNodeDef {
  key: string
  expectedType: 'string' | 'string[]' | 'number' | 'object'
  instruction: string
  example: unknown
  children?: ActionNodeDef[]
}

// Workflow templates (extend existing pipeline system):
interface SOPTemplate {
  name: string
  roles: SOPRole[]
  // Implicit pipeline: roles watch for each other's action outputs
}

// Pre-built templates:
const TEMPLATES = {
  software_project: {
    roles: [
      { profile: 'Product Manager', watches: ['UserRequirement'], actions: ['WritePRD'] },
      { profile: 'Architect', watches: ['WritePRD'], actions: ['WriteDesign'] },
      { profile: 'Project Manager', watches: ['WriteDesign'], actions: ['WriteTasks'] },
      { profile: 'Engineer', watches: ['WriteTasks'], actions: ['WriteCode'] },
      { profile: 'QA Engineer', watches: ['WriteCode'], actions: ['WriteTests'] },
    ]
  },
  code_review: {
    // ChatDev ComposedPhase pattern: loop reviewer↔programmer
    composed: true,
    maxCycles: 3,
    breakCondition: { type: 'keyword', keyword: '<DONE> Approved' },
    roles: [
      { profile: 'Reviewer', actions: ['ReviewCode'] },
      { profile: 'Programmer', actions: ['FixCode'] },
    ]
  }
}
```

**Execution engine** (MetaGPT round-based loop adapted for Next.js):

```typescript
// Core execution:
executeWorkflow(templateName, userInput, assignedAgents): Promise<string>
  // 1. Create pipeline_run record (existing table)
  // 2. Seed with UserRequirement message
  // 3. Run rounds until all roles idle or max rounds reached

executeRound(workflowRunId): Promise<boolean>
  // MetaGPT Environment.run() pattern:
  // 1. For each role: observe (check for unprocessed messages matching watches)
  // 2. If news found: think (select action based on reactMode) → act (call LLM)
  // 3. Validate output against Zod schema (Phase 0 repair pipeline)
  // 4. Publish result message (fans out to watching roles)
  // 5. Store artifact in pipeline_runs.output
  // 6. Return true if any role acted, false if all idle

// Budget guard (MetaGPT _check_balance pattern):
// Before each LLM call, check cumulative cost against budget
// If exceeded: mark workflow as 'budget_exceeded', stop execution
```

**New migration** (`041_sop_engine.sql`):

```sql
CREATE TABLE sop_messages (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  content TEXT NOT NULL,
  instruct_content TEXT,      -- Validated JSON output
  cause_by TEXT NOT NULL,     -- Action type that produced this
  sent_from TEXT NOT NULL,    -- Role that sent
  send_to TEXT DEFAULT '__all__',
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE sop_role_state (
  workflow_run_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  state INTEGER DEFAULT -1,
  is_idle INTEGER DEFAULT 1,
  last_observed_msg_id TEXT,
  PRIMARY KEY (workflow_run_id, role_id)
);

CREATE INDEX idx_sop_msgs_workflow ON sop_messages(workflow_run_id, cause_by);
```

**API routes**:
- `POST /api/workflows/sop/start` — start SOP workflow with template + user input
- `GET /api/workflows/sop/[id]` — workflow status with phase progress
- `GET /api/workflows/sop/[id]/artifacts` — all produced artifacts
- `POST /api/workflows/sop/[id]/pause` — pause workflow
- `POST /api/workflows/sop/[id]/resume` — resume workflow

**Tests**: 25+ unit tests (pub-sub routing, round execution, Zod validation, repair pipeline, budget guard, composed phase loops)

---

## Phase 5: Simulation Engine

**Source**: AI Town `agent.ts` decision loop + Agentchattr loop guard
**Depends on**: Phase 0-3 (LLM, memory, persona, conversations)

### Concept extraction

**From AI Town** — Agent tick behavior:
- Hybrid model: synchronous tick logic (rule-based, cheap) + async LLM operations
- Operation serialization: max one `inProgressOperation` per agent at a time
- Decision priority: task → remember → reflect → do something
- Cooldowns: 15s between conversations, 60s same-agent, 10s activity change
- 120-second operation timeout

**From Agentchattr** — Safety:
- Per-channel hop counter with human reset
- Max hops before auto-pause

### MC adaptation

**New file**: `src/lib/simulation-engine.ts`

```typescript
// Lazy-init pattern (per Sprint 1 S5/S6 fixes — NO module-level timers)
class SimulationEngine {
  private interval: NodeJS.Timeout | null = null
  private tickIntervalMs: number  // default 5000

  start(): void    // Begin simulation loop
  stop(): void     // Stop simulation loop
  pause(): void    // Temporarily pause
  tick(): Promise<void>  // Single tick (testable)
}

// Decision tree per agent per tick (AI Town pattern):
async function agentTick(agentId: number): Promise<void> {
  const agent = getAgent(agentId)
  if (agent.status !== 'idle') return  // Only idle agents act

  // Check for in-progress operation (AI Town serialization)
  if (hasInProgressOperation(agentId)) {
    checkOperationTimeout(agentId, 120_000)
    return
  }

  // Priority 1: Pending tasks
  const pendingTask = getNextPendingTask(agentId)
  if (pendingTask) { await workOnTask(agentId, pendingTask); return }

  // Priority 2: Conversations to remember
  const toRemember = getUnmemorizedConversations(agentId)
  if (toRemember.length > 0) { await rememberConversation(agentId, toRemember[0]); return }

  // Priority 3: Reflection threshold check
  if (shouldReflect(agentId)) { await reflect(agentId); return }

  // Priority 4: Do something (LLM decides)
  if (!onCooldown(agentId, 'action', 10_000)) {
    await agentDoSomething(agentId)
  }
}

// agentDoSomething: LLM picks next action
// Uses persona-aware prompt (Phase 2)
// Options: start conversation, work on activity, idle
// Respects cooldowns (Phase 3 hop guard)
```

**Safety controls**:
- `SIMULATION_ENABLED=false` by default (opt-in)
- Budget enforcement from Phase 0 (per-agent daily cap)
- Rate limiting: max 1 LLM call per agent per 30 seconds
- Hop guard from Agentchattr for agent-to-agent chains
- Kill switch API: `POST /api/simulation/stop`
- Dry-run mode: `SIMULATION_DRY_RUN=true` logs decisions without calling LLM

**API routes**:
- `POST /api/simulation/start` — start simulation engine
- `POST /api/simulation/stop` — stop simulation engine
- `POST /api/simulation/tick` — manual single tick (for testing)
- `GET /api/simulation/status` — engine status, per-agent state

**Tests**: 25+ unit tests (decision priority, cooldowns, operation timeout, budget enforcement, dry-run, kill switch, hop guard integration)

---

## Phase 6: Experiential Learning (Future)

**Source**: ChatDev v2 Experiential Co-Learning
**Depends on**: Phase 4 (workflow runs produce learnable data)
**Priority**: P3 (defer until Phases 0-5 proven)

### Concept (for reference)

ChatDev's ECL runs AFTER a workflow session completes:
1. Parse session log → reconstruct directed graph of code snapshots
2. Find shortest path (remove dead-end explorations)
3. Score each node: `compile_weight * degree_weight * code_similarity * text_similarity * (1/distance)`
4. Extract "shortcuts": edges that skip intermediate steps with significant value gain
5. Generate `instructionStar` per shortcut: LLM describes how to go from A to B directly
6. Store with embeddings for retrieval in future sessions

**MC application**: After a workflow SOP run completes (Phase 4), analyze the artifact chain. If the workflow had a review↔fix cycle that took 3 iterations, generate a shortcut instruction that combines the reviewer's feedback into one prompt. Store for future runs of the same template.

**Tables needed**: `ecl_shortcuts(id, template_name, source_hash, target_hash, value_gain, instruction_star, embedding, created_at)`

**Not implementing now** — this requires Phase 4 to be stable and producing sufficient data to learn from.

---

## Dependency Map

```
Phase 0: LLM Integration Layer
    ↓
Phase 1: Agent Memory System
    ↓
Phase 2: Persona Engine ──────────────────────┐
    ↓                                          │
Phase 3: Conversation Lifecycle + Debate       │
    ↓                                          │
Phase 4: Workflow SOP Engine ←─────────────────┘
    ↓
Phase 5: Simulation Engine
    ↓ (future, after stability proven)
Phase 6: Experiential Learning
```

Each phase is independently shippable. Phase 0 alone gives MC LLM capability. Phase 0+1 gives persistent memory. Phase 0+1+2 gives rich personas. And so on.

---

## Scope Summary

| Phase | New Files | Modified Files | New Tests | New Migrations | New Deps | Risk |
|-------|-----------|---------------|-----------|----------------|----------|------|
| 0 — LLM Layer | 5 | 1-2 | 15 | 0 | 0-1 | Low |
| 1 — Memory | 2-3 | 1 | 25 | 1 | 0 | Low |
| 2 — Persona | 2 | 2 | 15 | 0 | 0 | Low |
| 3 — Conversations | 2-3 | 2 | 20 | 1 | 0 | Medium |
| 4 — SOP Engine | 3-4 | 2 | 25 | 1 | 0 | High |
| 5 — Simulation | 2-3 | 2 | 25 | 0 | 0 | High |
| 6 — ECL (future) | 2 | 1 | 10 | 1 | 0 | Medium |
| **Total (0-5)** | **16-20** | **10-12** | **125** | **3** | **0-1** | — |

---

## Quality Gates (per phase)

Every phase must pass before merging:
1. `pnpm lint` — 0 errors
2. `pnpm typecheck` — 0 errors
3. `pnpm test` — all tests pass (existing 147 + new)
4. `pnpm build` — clean build
5. 0 `as any` in new code
6. All new API routes use Zod validation (MC pattern)
7. All new routes broadcast via eventBus (MC pattern)
8. Feature flag exists to disable the feature entirely

---

## Success Metrics (Automated)

| Metric | Target | How Measured |
|--------|--------|-------------|
| Memory recall latency | <200ms p95 | Timer in `recall()` |
| Memory relevance (golden set) | 4/5 expected results in top-5 | 50 known query→result pairs |
| Conversation turn latency | <3s p95 | Timer in `continueConversation()` |
| Consensus detection accuracy | 100% on `<DONE>` keyword | Unit test suite |
| Hop guard prevents runaway | 0 chains > maxHops | Counter assertion |
| SOP workflow completion | >90% reach final phase | `pipeline_runs.status` query |
| Zod validation pass rate | >95% on LLM outputs | Repair pipeline counter |
| Simulation stability | 0 crashes over 1000 ticks | Automated stress test |
| Budget enforcement | 0 agents exceed daily cap | Token usage audit query |
| DB growth | <50MB/month per 10 agents | SQLite file size tracking |
| Test coverage (new code) | >80% line coverage | Vitest coverage report |

---

## What We Explicitly Do NOT Build

| Feature | Reason |
|---------|--------|
| Convex backend | MC uses SQLite + Next.js. NO platform dependency. |
| PixiJS rendering | MC's CSS/SVG office works. Different visual paradigm. |
| Tile-based pathfinding | MC uses zone-based layout. |
| Auto-hiring (Agent Office) | 15-star repo, trivial counter logic, not worth porting. |
| Colyseus real-time sync | MC has SSE + WebSocket + polling. |
| Human player joining | MC is a dashboard, not a game. |
| Music generation | Not relevant. |
| Python runtime/sidecar | All patterns reimplemented in TypeScript. |
