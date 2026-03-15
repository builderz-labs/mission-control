# Feature Research

**Domain:** AI Multi-Agent Orchestration Platform
**Researched:** 2026-03-15
**Confidence:** MEDIUM (multi-source synthesis; individual source confidence varies)

## Reference Platforms Studied

| Platform | Primary Focus | License | Key Innovation |
|----------|--------------|---------|----------------|
| MetaGPT | SOP-driven software dev | MIT | Structured artifact handoffs via publish-subscribe message pool |
| ChatDev | Communicative agent collab | Apache 2.0 | Chat chain with dual-agent instructor/assistant phases |
| TinyTroupe | Persona simulation | MIT | Big Five traits, episodic/semantic memory, cognitive faculties |
| AI Town | Spatial agent world | MIT | PixiJS 2D tilemap with Convex real-time game loop |
| AutoGen | Multi-agent conversations | MIT | GroupChat with pluggable speaker selection strategies |
| CrewAI | Role-based agent crews | MIT | Hierarchical/sequential process with manager delegation |
| LangGraph | State machine workflows | MIT | Directed graph with typed state, checkpoint persistence |

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist in any agent orchestration dashboard. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Agent topology view** (nodes + edges) | Every orchestration tool shows agent relationships visually | MEDIUM | @xyflow/react already in deps; custom nodes for agent cards, edges for relationships |
| **Workflow definition** (sequential phases) | MetaGPT/CrewAI/LangGraph all offer this; users expect ordered task flow | MEDIUM | SQLite tables for workflow templates + phases + artifact schemas |
| **@mention message routing** | Slack/Discord/OpenClaw all route by @name; natural UX for mixed human-agent chat | LOW | Extend existing Hermes chat; regex parse @agent_name from message body |
| **Agent status on canvas** (idle/busy/error) | Any dashboard shows agent health state | LOW | Already have agent status; wire to node color/badge on spatial view |
| **Message flow visualization** (animated edges) | Users expect to see messages moving between agents | MEDIUM | React Flow animated edges with SVG keyframes along edge paths |
| **Human-in-the-loop approval** | AutoGen, CrewAI, and LangGraph all support HITL; critical for trust | LOW | Add approval_required flag to workflow phase; SSE notification to human |

### Differentiators (Competitive Advantage)

Features that set Mission Control apart from monitoring-only dashboards.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Structured debate rooms** | No existing dashboard offers visual debate trees with rounds + voting; ChatDev has chat chains but no deliberation UI | HIGH | New subsystem: rooms, rounds, positions, votes; threaded argument tree view |
| **Deep persona simulation** (Big Five + emotional state) | TinyTroupe does this in Python CLI; no dashboard exposes persona knobs visually | HIGH | JSON columns for OCEAN scores, valence/arousal, cognitive biases; persona-aware prompt construction |
| **Auto-hiring/self-scaling** | Academic concept (AgentSpawn, IAAG/DRTAG); no open-source dashboard implements this | HIGH | Event-driven: agent emits hire_request, orchestrator evaluates, spawns from template |
| **Artifact-validated phase transitions** | MetaGPT validates between phases but has no UI for it; visual artifact flow is unique | MEDIUM | JSON Schema validation on phase outputs; blocked transition if schema fails |
| **Trust scores between agent pairs** | Academic research (EigenTrust, TD-learning); no dashboard visualizes trust graphs | MEDIUM | Pairwise trust table updated by interaction outcomes; edge thickness on spatial view |
| **Drag-and-drop workflow builder** | CrewAI has plot() but no interactive builder; LangGraph is code-only | HIGH | @xyflow/react workflow canvas distinct from spatial view; phase nodes with artifact connectors |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems in our constraints (SQLite + SSE + Next.js).

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **3D spatial visualization** | Looks impressive in demos | Massive complexity, poor UX for operational tasks, WebGL perf issues with 50+ agents | 2D @xyflow/react canvas with zoom/pan; 3D adds no operational value |
| **Real-time voice/video channels** | "Like Discord for agents" | Requires WebRTC, media servers, bandwidth; text is sufficient for LLM agents | Text-only chat with SSE streaming; agents don't benefit from voice |
| **Full game-engine spatial world** (AI Town style) | Pixel-art agents walking around is fun | Requires PixiJS + game loop + tilemap + pathfinding; entertainment, not operational | Static spatial layout with drag-to-position; operational clarity over animation |
| **Autonomous agent spawning** (no human approval) | "Let agents hire other agents freely" | Runaway costs, resource exhaustion, loss of human oversight | Auto-hire with human approval gate; suggest spawning, don't auto-execute |
| **WebSocket real-time** | "SSE is one-directional" | Adds infrastructure complexity, incompatible with serverless/edge deployment | SSE for server-to-client push + HTTP POST for client-to-server; sufficient for all 6 features |
| **Persistent agent memory across sessions** (full RAG) | "Agents should remember everything" | Requires vector DB, embedding pipeline, retrieval infra | Scoped memory per workflow/debate session; SQLite JSON columns for recent context |
| **Free-form agent conversation** (no structure) | "Just let agents chat naturally" | Produces incoherent, hallucinated, circular dialogue; ChatDev research confirms this | Structured communication: chat chains, debate rounds, or artifact-mediated handoffs |
| **Personality fine-tuning of LLMs** | "Train the model to match the persona" | Requires fine-tuning infrastructure, GPU, training data pipelines | Prompt injection of persona traits; TinyTroupe proves system-prompt personas work well |

---

## Deep Dive: Feature Research

### 1. Spatial 2D Visualization

**Reference implementations:**

**AI Town (a16z-infra)** [HIGH confidence]
- Uses PixiJS (pixi-react) for pixel-art tilemap rendering
- Game engine in `convex/engine` handles tick-based updates
- `World` contains players with `(x, y)` positions and pathfinding state
- `Player` has name, description, current location, optional pathfinding destination
- Collision detection triggers path replanning
- Conversations lock player movement (must leave conversation to move)
- Map loaded from Tiled CSV export as 2D array
- Runs 1-5 simulated minutes per real-world second
- Source: [github.com/a16z-infra/ai-town/ARCHITECTURE.md](https://github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md)

**AutoGen Studio** [MEDIUM confidence]
- Drag-and-drop UI for agent workflow specification
- JSON-based declarative agent specification
- Built-in debugging and monitoring of workflows
- Being rewritten for AutoGen 0.4 API (AgentChat)
- Source: [microsoft.github.io/autogen/dev/autogenstudio](https://microsoft.github.io/autogen/dev//user-guide/autogenstudio-user-guide/index.html)

**CrewAI Flows Visualization** [MEDIUM confidence]
- `flow.plot()` generates interactive HTML visualization
- Shows tasks, connections, and data flow as graph
- Graphical representation identifies bottlenecks
- Not interactive (read-only export)
- Source: [docs.crewai.com/en/concepts/flows](https://docs.crewai.com/en/concepts/flows)

**LangGraph** [HIGH confidence]
- Agents are graph nodes, edges define control + data flow
- `get_graph()` and `draw_mermaid_png()` for visualization export
- State machine model: `__start__` -> nodes -> `__end__`
- Directed graph with typed state flowing through edges
- Source: [docs.langchain.com/oss/python/langgraph/overview](https://docs.langchain.com/oss/python/langgraph/overview)

**@xyflow/react capabilities** [HIGH confidence]
- 4 edge types: Bezier, Step, SmoothStep, Straight
- Animated edges via SVG keyframes + Web Animations API (`offsetPath`/`offsetDistance`)
- Custom nodes with React components (handles for source/target connections)
- MiniMap, Controls, Background plugin components
- Viewport zoom/pan with controlled or uncontrolled modes
- Only re-renders changed nodes (performance optimization)
- Source: [reactflow.dev/examples](https://reactflow.dev/examples)

**Our approach for Mission Control:**
- @xyflow/react canvas (already in deps) with custom agent nodes
- Agent node: avatar/icon, name, role, status badge (idle/busy/error/offline)
- Edge types: relationship (solid), message flow (animated dashed), hierarchy (thick)
- Click node -> detail panel (existing pattern in MC)
- Drag to reposition; positions saved to SQLite `agent_positions` table
- SSE updates push status changes -> node re-renders
- MiniMap for large agent fleets (50+ agents)
- No game loop, no pathfinding, no tilemap -- operational dashboard, not simulation

---

### 2. Structured Workflow Engine

**Reference implementations:**

**MetaGPT SOP Pipeline** [HIGH confidence]
- 5 sequential roles: Product Manager -> Architect -> Project Manager -> Engineer -> QA Engineer
- Each role produces structured artifacts: PRD, system design (UML, file lists, interfaces), task distribution, code, tests
- Shared message pool: agents publish structured outputs, subscribers watch for relevant messages
- `_observe()` -> `_think()` -> `_act()` -> `publish_message()` cycle per role
- Dependencies enforced: action only initiates when all prerequisite info received from pool
- Artifact validation via schema: "handovers between agents must comply with established standards"
- Executable feedback mechanism: code is run and errors fed back for iteration
- Source: [arxiv.org/html/2308.00352v6](https://arxiv.org/html/2308.00352v6), [github.com/FoundationAgents/MetaGPT](https://github.com/FoundationAgents/MetaGPT)

**ChatDev Chat Chain** [HIGH confidence]
- 3 sequential phases: Design -> Coding -> Testing
- Coding subdivided: Code Writing + Code Completion
- Testing subdivided: Peer Review (static) + System Testing (dynamic)
- Each chat in chain: 1 instructor agent + 1 assistant agent (dual-agent design)
- Self-reflection: when consensus reached without expected termination string, pseudo-self of assistant re-engages
- No retrieval module or memory reflection (sequential nature makes info flow predictable)
- Roles: CEO, CTO, CPO, Programmer, Reviewer, Tester, Designer
- Source: [arxiv.org/html/2307.07924v5](https://arxiv.org/html/2307.07924v5), [github.com/OpenBMB/ChatDev](https://github.com/OpenBMB/ChatDev)

**CrewAI Process Types** [HIGH confidence]
- Sequential: agents execute one after another in defined order
- Hierarchical: manager agent dynamically delegates to workers based on role/goal/capability
- Manager evaluates tasks, assigns to appropriate agents, validates results before proceeding
- `Process.sequential` (default) vs `Process.hierarchical`
- Hierarchical adds latency (extra LLM calls for delegation decisions)
- Manager agent must NOT be in the agents list (operates outside worker pool)
- Flows: event-driven execution engine above crews; `step A -> check result -> step B or C`
- Source: [docs.crewai.com/en/learn/hierarchical-process](https://docs.crewai.com/en/learn/hierarchical-process)

**LangGraph State Machine** [HIGH confidence]
- Workflows as directed graphs: nodes (agent logic), edges (transitions)
- Shared typed state flows through graph
- Built-in checkpointing for persistence and recovery
- Conditional edges for branching logic
- Source: [langchain.com/langgraph](https://www.langchain.com/langgraph)

**Our approach for Mission Control:**
- Workflow template: name, description, ordered phases, created_by
- Phase: name, sequence_number, assigned_agent_id, input_schema (JSON Schema), output_schema (JSON Schema)
- Phase transition: validate output against schema before advancing
- Execution model: sequential (default), parallel (multiple phases at same sequence_number), conditional (branch expression)
- Artifact storage: `workflow_artifacts` table with phase_id, content (JSON), validated (boolean)
- MetaGPT-inspired message pool: agents publish phase outputs, downstream phases subscribe
- Human approval gates: optional per-phase `requires_approval` flag
- SSE events for phase transitions: `workflow:phase_started`, `workflow:phase_completed`, `workflow:phase_failed`

---

### 3. Debate/Consensus Rooms

**Reference implementations:**

**AutoGen Multi-Agent Debate** [HIGH confidence]
- Two agent types: solver agents + aggregator agent
- Sparse communication topology (not all-to-all): solvers connected to neighbors only
- Fixed number of rounds: problem distributed -> solvers exchange -> refine -> final answer
- Aggregator uses majority voting for consensus
- Topic-based subscriptions for message routing between solvers
- Source: [microsoft.github.io/autogen/stable/user-guide/core-user-guide/design-patterns/multi-agent-debate.html](https://microsoft.github.io/autogen/stable//user-guide/core-user-guide/design-patterns/multi-agent-debate.html)

**AutoGen GroupChat Speaker Selection** [HIGH confidence]
- 4 built-in strategies: `round_robin`, `random`, `manual` (human picks), `auto` (LLM decides)
- Custom speaker selection via callable: `(last_speaker, group_chat) -> Agent`
- GroupChatManager orchestrates, broadcasts messages to all agents
- Source: [microsoft.github.io/autogen/0.2/docs/tutorial/conversation-patterns/](https://microsoft.github.io/autogen/0.2/docs/tutorial/conversation-patterns/)

**ChatDev Communicative Dehallucination** [MEDIUM confidence]
- Role reversal: assistant takes instructor-like role, seeks clarification before responding
- Self-reflection when consensus stalls: pseudo-self re-engages assistant
- MacNet (Multi-Agent Collaboration Networks): DAG-structured agent interactions, topological ordering
- Source: [arxiv.org/html/2307.07924v5](https://arxiv.org/html/2307.07924v5)

**Academic Multi-Agent Debate Research** [MEDIUM confidence]
- Voting protocols improve reasoning by 13.2%, consensus protocols improve knowledge tasks by 2.8%
- Majority voting without debate often matches MAD performance (important finding)
- Consensus levels: majority (50%+), supermajority (66%+), unanimity (100%)
- Judge agent evaluates argument validity and synthesizes solutions
- Confidence-weighted voting outperforms simple majority for complex tasks
- Bayesian aggregation can stagnate (belief martingale); asymmetric interventions help
- Source: [arxiv.org/abs/2502.19130](https://arxiv.org/abs/2502.19130)

**Our approach for Mission Control:**
- Debate room: topic, moderator_agent_id, participant_agent_ids, max_rounds, consensus_threshold
- Structured rounds: propose -> critique -> rebut -> vote (configurable protocol)
- Round model: round_number, phase (propose/critique/rebut/vote), active_agent_id
- Position model: agent_id, round_id, content, position_type (proposal/critique/rebuttal/vote)
- Voting: majority (default), supermajority, unanimity; configurable per room
- Moderator agent enforces protocol (ensures all agents participate, advances rounds)
- Argument tree view: threaded display of positions linked to what they respond to
- Consensus detection: when threshold met, room closes with recorded decision
- SSE events: `debate:round_started`, `debate:position_submitted`, `debate:vote_cast`, `debate:consensus_reached`

---

### 4. Deep Persona Simulation

**Reference implementations:**

**TinyTroupe (Microsoft)** [HIGH confidence]
- `TinyPerson` class with rich persona dictionary: name, age, nationality, occupation, residence
- Big Five personality traits (OCEAN): Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism
- Cognitive state model: goals, context, attention, emotions (default: "calm")
- Episodic memory: temporal event storage with fixed prefix (20 items) + lookback window (100 items)
- Semantic memory: concept-based, non-temporal knowledge with relevance-based retrieval
- Memory consolidation: `EpisodicConsolidator` reorganizes, `ReflectionConsolidator` produces abstractions
- Mental faculties: RecallFaculty (keyword search), FilesAndWebGroundingFaculty (external info), CustomMentalFaculty
- Action types: TALK, THINK, LISTEN, DONE, RECALL, CONSULT
- `MAX_ACTIONS_BEFORE_DONE = 15` prevents infinite loops
- `MAX_ACTION_SIMILARITY = 0.85` prevents repetitive behavior
- `listen(stimulus)` -> `act()` -> `think(content)` interaction cycle
- `generate_agent_system_prompt()` constructs persona-aware LLM instructions
- Full JSON serialization for simulation persistence
- Source: [microsoft.github.io/TinyTroupe/api/tinytroupe/agent/](https://microsoft.github.io/TinyTroupe/api/tinytroupe/agent/index.html), [github.com/microsoft/TinyTroupe](https://github.com/microsoft/TinyTroupe)

**AI Town Agent Personalities** [MEDIUM confidence]
- Character identity: name, description, backstory
- Personality injected into conversation prompts
- Memory stream for previous interactions
- Source: [stack.convex.dev/building-ai-town-character-ids](https://stack.convex.dev/building-ai-town-character-ids)

**Our approach for Mission Control:**
- `agent_personas` table: agent_id, ocean_scores (JSON: {O, C, E, A, N} each 0.0-1.0)
- Emotional state: valence (-1.0 to 1.0), arousal (0.0 to 1.0), updated per interaction
- Cognitive biases: array of active biases (confirmation, anchoring, availability, etc.)
- `agent_relationships` table: agent_a_id, agent_b_id, trust_score (0.0-1.0), interaction_count, last_interaction
- Trust updated by interaction outcomes: successful collaboration +delta, conflict -delta
- Persona prompt builder: maps OCEAN scores to behavioral descriptors injected into system prompt
  - High O (>0.7): "creative, open to unconventional solutions"
  - Low C (<0.3): "flexible but may overlook details"
  - High N (>0.7): "cautious, sensitive to risk, thorough in error checking"
- Emotional state influences response style: high arousal + negative valence = urgent/terse responses
- Bias simulation: confirmation bias -> agent weighs evidence supporting prior position more heavily
- No vector DB: use SQLite JSON columns + prompt injection (TinyTroupe proves this works)

---

### 5. Auto-Hiring/Self-Scaling

**Reference implementations:**

**AgentSpawn** [MEDIUM confidence]
- Dynamic spawning triggered by runtime complexity metrics
- Automatic memory transfer during spawning (selective memory slicing)
- 34% higher completion rates than static baselines
- 42% memory overhead reduction through selective slicing
- Addresses: memory continuity, skill inheritance, task resumption, runtime spawning, concurrent coherence
- Source: [arxiv.org/html/2602.07072](https://arxiv.org/html/2602.07072)

**IAAG/DRTAG (Frontiers in AI, 2025)** [MEDIUM confidence]
- IAAG (Initial Automatic Agent Generation): creates agents at system init via persona pattern prompting + chain prompting + few-shot prompting
- DRTAG (Dynamic Real-Time Agent Generation): on-demand agent creation during operation, driven by conversational/task context
- Evaluation metrics: binary weighting (coverage), TF-IDF (keyword richness), MTLD (lexical diversity), BERTScore (thematic relevance)
- No explicit scale-down mechanism described
- Source: [frontiersin.org/frai.2025.1638227](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1638227/full)

**General Patterns** [MEDIUM confidence]
- Queue-based scaling: monitor queue depth + agent response times to trigger scaling
- Template-based instantiation: predefined agent templates reduce cold-start latency
- Orchestrator evaluates hire requests, spawns from template, assigns queue subset
- Scale-down: idle threshold (no tasks for N minutes) triggers decommission
- Source: [agenticaiguide.ai/ch_8/sec_8-3.html](https://agenticaiguide.ai/ch_8/sec_8-3.html)

**CrewAI AMP (Production)** [LOW confidence]
- Tracing & Observability: real-time metrics, logs, traces
- Unified Control Plane for monitoring and scaling
- For long-running crews: external state store (Redis/SQL) recommended
- Source: [crewai.com/amp](https://crewai.com/amp)

**Our approach for Mission Control:**
- Scaling metrics monitored per agent: task_queue_depth, avg_response_time_ms, error_rate
- Hire request event: agent publishes `agent:hire_request` via event bus with desired specialization + reason
- Orchestrator evaluates: checks agent templates, available budget, current fleet size
- Human approval gate (configurable): admin approves/rejects hire request before spawn
- Agent templates: predefined configs (role, persona, tools, LLM tier) for quick instantiation
- Scale-down: idle_threshold_minutes (configurable, default 30); idle agents marked for review, not auto-deleted
- `agent_scaling_events` table: event_type (hire_request/spawn/scale_down), agent_id, template_id, metrics_snapshot, approved_by
- SSE events: `scaling:hire_requested`, `scaling:agent_spawned`, `scaling:agent_decommissioned`

---

### 6. @Mention Team Chat

**Reference implementations:**

**OpenClaw Multi-Agent Routing** [HIGH confidence]
- Deterministic "most-specific wins" routing: peer match > guild/team > account > channel > default
- `mentionPatterns`: array of patterns like "@family", "@familybot" for group-level mention gating
- `requireMention: true` at group level (quiet unless @mentioned)
- `requireMention: false` in agent's own topic (responds freely)
- Each agent: own workspace, state directory, session store
- Source: [docs.openclaw.ai/concepts/multi-agent](https://docs.openclaw.ai/concepts/multi-agent)

**AutoGen GroupChat** [HIGH confidence]
- All agents share single conversation thread + context
- GroupChatManager selects speaker and broadcasts to all
- `human_input_mode`: NEVER, TERMINATE, ALWAYS (for human-in-the-loop)
- Source: [microsoft.github.io/autogen/0.2/docs/tutorial/conversation-patterns/](https://microsoft.github.io/autogen/0.2/docs/tutorial/conversation-patterns/)

**n8n @Mention Workflow** [MEDIUM confidence]
- Loop Over Items iterates through selected agents
- If node checks if first agent responding
- First agent gets original user message; subsequent agents get formatted output from previous
- Source: [n8n.io/workflows/3473](https://n8n.io/workflows/3473-scalable-multi-agent-chat-using-mentions/)

**Mission Control (existing Hermes)** [HIGH confidence]
- Already has: channels, messages, message routing
- Missing: @agent_name parsing, agent auto-response, @all/@team:name addressing
- SSE already supports real-time message delivery

**Our approach for Mission Control:**
- Parse @mentions from message body via regex: `/@(\w+)/g`
- Mention types: `@agent_name` (single), `@all` (broadcast), `@team:name` (team group)
- `message_mentions` table: message_id, mentioned_agent_id, mention_type
- Agent auto-response: when mentioned, agent receives message via existing event bus, generates response, posts to same channel
- Routing priority: direct mention > team mention > broadcast
- Human messages in same timeline as agent messages (shared channel)
- `requireMention` flag per agent per channel (some agents respond to all messages, others only when @mentioned)
- Rate limiting: max N agent responses per minute per channel (prevent runaway conversations)
- SSE events: `chat:mention_received`, `chat:agent_response`

---

## Feature Dependencies

```
[Spatial 2D Visualization]
    |
    |--requires--> Agent CRUD + status (EXISTING)
    |--requires--> SSE real-time events (EXISTING)
    |--enhances--> [Workflow Engine] (show workflow graph on canvas)
    |--enhances--> [Debate Rooms] (show debate participants spatially)
    |--enhances--> [Persona Simulation] (trust edges on spatial view)
    |--enhances--> [Auto-Hiring] (new agent appears on canvas)

[Structured Workflow Engine]
    |
    |--requires--> Agent CRUD + task system (EXISTING)
    |--requires--> SSE real-time events (EXISTING)
    |--enhances--> [Spatial Visualization] (workflow graph overlay)
    |--enhances--> [Auto-Hiring] (workflow detects bottleneck -> hire request)

[@Mention Team Chat]
    |
    |--requires--> Hermes chat system (EXISTING)
    |--requires--> Agent CRUD (EXISTING)
    |--enhances--> [Debate Rooms] (debate messages appear in chat)
    |--enhances--> [Workflow Engine] (phase transitions announced in chat)

[Debate/Consensus Rooms]
    |
    |--requires--> Agent CRUD (EXISTING)
    |--requires--> [@Mention Team Chat] (messages route to debate participants)
    |--enhances--> [Workflow Engine] (debate as a phase type)
    |--enhances--> [Persona Simulation] (persona influences debate positions)

[Deep Persona Simulation]
    |
    |--requires--> Agent CRUD (EXISTING)
    |--requires--> LLM router (EXISTING)
    |--enhances--> [Debate Rooms] (persona shapes argumentation style)
    |--enhances--> [@Mention Chat] (persona influences response tone)
    |--enhances--> [Workflow Engine] (persona affects artifact quality/style)

[Auto-Hiring/Self-Scaling]
    |
    |--requires--> Agent CRUD + templates (EXISTING + new)
    |--requires--> [Workflow Engine] (detects phase bottlenecks)
    |--requires--> SSE event bus (EXISTING)
    |--enhances--> [Spatial Visualization] (new agents appear on canvas)
    |--enhances--> [@Mention Chat] (announce hire/scale events in chat)
```

### Dependency Notes

- **Spatial Visualization requires nothing new:** Builds entirely on existing agent CRUD + SSE. Can be built first.
- **@Mention Chat requires nothing new:** Extends existing Hermes. Can be built first.
- **Workflow Engine requires nothing new:** Builds on existing agent + task system. Can be built first.
- **Debate Rooms soft-requires @Mention Chat:** Debate messages route through chat; can work standalone but better with chat integration.
- **Persona Simulation requires nothing new:** Adds JSON columns to agents; independent. But value multiplies when combined with debate + chat.
- **Auto-Hiring requires Workflow Engine:** Bottleneck detection in workflows triggers hire requests. This is the most dependent feature.
- **No conflicts:** All 6 features are complementary. No feature blocks another.

---

## MVP Definition

### Launch With (v1.0)

Minimum viable version of each feature -- enough to validate the concept.

- [ ] **Spatial 2D Visualization (MVP)** -- Static @xyflow/react canvas with agent nodes (name + status badge), relationship edges, click-to-detail. No animations, no message flow. Drag to reposition.
- [ ] **Structured Workflow Engine (MVP)** -- Sequential-only workflows. Define template with ordered phases. Assign agent per phase. Manual artifact passing (no JSON Schema validation yet). Phase status tracking.
- [ ] **@Mention Team Chat (MVP)** -- Parse @agent_name from messages. Route to agent. Agent auto-responds in channel. @all broadcast. Shared human-agent timeline.

**Rationale:** These 3 features are lowest complexity, require no new dependencies, build on existing infrastructure, and give immediate visible value. Each is independently useful.

### Add After Validation (v1.x)

Features to add once core 3 are working and validated.

- [ ] **Debate/Consensus Rooms (v1.1)** -- Add when users need agents to deliberate. Start with simple propose-vote (2 rounds). Add critique-rebut rounds later. Majority voting only.
- [ ] **Deep Persona Simulation (v1.2)** -- Add when users want differentiated agent behavior. Start with OCEAN scores + basic prompt injection. Add emotional state and cognitive biases later.
- [ ] **Animated message flow on spatial view (v1.1)** -- Add animated edges showing real-time message flow between agents. Requires spatial view + SSE.
- [ ] **Artifact validation in workflows (v1.2)** -- Add JSON Schema validation on phase transitions. Blocked transitions on schema failure. Retry mechanism.
- [ ] **@team:name group addressing (v1.1)** -- Add team-level mention routing. Requires team concept in agent groups.

### Future Consideration (v2+)

Features to defer until core platform proven.

- [ ] **Auto-Hiring/Self-Scaling (v2.0)** -- Most complex feature. Requires workflow engine maturity + template system + approval gates. Risk of runaway costs without careful design. Defer until workflow engine proves bottleneck detection is reliable.
- [ ] **Trust graph visualization (v2.0)** -- Pairwise trust scores between agents shown as edge weights on spatial view. Requires enough agent interactions to have meaningful data.
- [ ] **Drag-and-drop workflow builder (v2.0)** -- Visual workflow construction on @xyflow/react canvas. High UI complexity. Start with form-based workflow definition in v1.
- [ ] **Conditional/parallel workflow branches (v2.0)** -- Add branching expressions and parallel phase execution. Sequential is sufficient for MVP.
- [ ] **Confidence-weighted voting in debates (v2.0)** -- Replace simple majority with weighted voting. Requires persona simulation for confidence calibration.
- [ ] **Memory consolidation (episodic -> semantic) (v2+)** -- TinyTroupe-style memory abstraction. Requires significant prompt engineering and storage design.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Complexity |
|---------|------------|---------------------|----------|------------|
| Spatial 2D Visualization (basic) | HIGH | MEDIUM | **P1** | ~3 days |
| @Mention Team Chat | HIGH | LOW | **P1** | ~2 days |
| Structured Workflow Engine (sequential) | HIGH | MEDIUM | **P1** | ~4 days |
| Animated message flow edges | MEDIUM | LOW | **P2** | ~1 day |
| Debate/Consensus Rooms (basic) | MEDIUM | HIGH | **P2** | ~5 days |
| Deep Persona Simulation (OCEAN) | MEDIUM | MEDIUM | **P2** | ~3 days |
| Artifact validation (JSON Schema) | MEDIUM | MEDIUM | **P2** | ~2 days |
| @team:name group mentions | LOW | LOW | **P2** | ~1 day |
| Auto-Hiring/Self-Scaling | HIGH | HIGH | **P3** | ~6 days |
| Trust graph visualization | LOW | MEDIUM | **P3** | ~2 days |
| Drag-and-drop workflow builder | MEDIUM | HIGH | **P3** | ~5 days |
| Conditional/parallel workflows | MEDIUM | HIGH | **P3** | ~4 days |

**Priority key:**
- P1: Must have for launch (v1.0)
- P2: Should have, add when possible (v1.x)
- P3: Nice to have, future consideration (v2+)

---

## Competitor Feature Comparison Matrix

| Feature | MetaGPT | ChatDev | TinyTroupe | AI Town | AutoGen | CrewAI | LangGraph | **Mission Control (planned)** |
|---------|---------|---------|------------|---------|---------|--------|-----------|-------------------------------|
| **Spatial visualization** | None | None | None | PixiJS 2D tilemap | Studio drag-drop | Flow plot (static) | Mermaid export | @xyflow/react interactive canvas |
| **Workflow engine** | SOP pipeline (5 roles) | Chat chain (3 phases) | None | None | Nested chat | Sequential/Hierarchical | State machine graph | Template-based phases with artifact schemas |
| **Debate/consensus** | None | Dual-agent chat + self-reflection | None | Conversation system | GroupChat + multi-agent debate | None | None | Structured rounds + voting + argument tree |
| **Persona simulation** | Role profiles (shallow) | Role prompts | Big Five + episodic/semantic memory + cognitive state | Character backstory | System message persona | Role + goal + backstory | None | OCEAN scores + emotional state + cognitive biases + trust |
| **Auto-scaling** | None | None | None | None | None | AMP (paid) | None | Event-driven hire requests + template spawning |
| **@Mention chat** | Message pool (pub/sub) | Instructor/assistant pairs | listen/act | Conversation bubbles | GroupChat broadcast | None | None | @agent_name routing in shared timeline |
| **Human-in-the-loop** | None | None | None | Human player | ALWAYS/TERMINATE modes | Approval hooks | Interrupt nodes | Per-phase approval + debate participation |
| **Artifact validation** | Schema-based handoffs | None | None | None | None | Task output validation | State typing | JSON Schema per phase transition |
| **Dashboard/UI** | CLI only | CLI + web gallery | CLI (Python) | Pixel-art web game | Studio web UI | Enterprise cloud UI | None (library) | Full web dashboard with 33+ panels |
| **Real-time updates** | None | None | None | Convex reactive | None | AMP tracing | None | SSE event bus |
| **Persistence** | File system | File system | JSON serialization | Convex DB | File system | SQLite/Redis | Checkpoint store | SQLite (better-sqlite3) |
| **Auth/RBAC** | None | None | None | None | None | Enterprise only | None | Built-in (admin/operator/viewer) |

### Key Differentiators for Mission Control

1. **Unified platform:** No competitor combines all 6 capabilities in a single dashboard with auth, persistence, and real-time updates.
2. **Web-native:** Most competitors are Python CLI tools or libraries. MC is a full web application out of the box.
3. **Operational focus:** AI Town optimizes for entertainment, MetaGPT/ChatDev for code generation. MC targets operational orchestration.
4. **Open source with batteries included:** CrewAI's advanced features (AMP, tracing) are paid. MC includes everything.
5. **Human-in-the-loop first:** Most competitors bolt on HITL as an afterthought. MC designs around mixed human-agent teams.

---

## Technical Implementation Notes (Next.js + SQLite + SSE)

### Database Schema (New Tables)

```
agent_positions         -- Spatial view positions
  agent_id TEXT PK FK
  x REAL, y REAL
  updated_at TEXT

workflow_templates      -- Workflow definitions
  id TEXT PK
  name TEXT, description TEXT
  created_by TEXT, created_at TEXT

workflow_phases         -- Ordered phases within template
  id TEXT PK
  template_id TEXT FK
  name TEXT, sequence_number INT
  assigned_agent_id TEXT FK
  input_schema TEXT (JSON)
  output_schema TEXT (JSON)
  requires_approval BOOLEAN

workflow_executions     -- Running instances
  id TEXT PK
  template_id TEXT FK
  status TEXT (pending/running/completed/failed)
  current_phase_id TEXT FK
  started_at TEXT, completed_at TEXT

workflow_artifacts      -- Phase outputs
  id TEXT PK
  execution_id TEXT FK
  phase_id TEXT FK
  content TEXT (JSON)
  validated BOOLEAN
  created_at TEXT

debate_rooms            -- Deliberation sessions
  id TEXT PK
  topic TEXT
  moderator_agent_id TEXT FK
  max_rounds INT
  consensus_threshold REAL
  status TEXT (open/voting/closed)
  decision TEXT (JSON)

debate_positions        -- Agent arguments
  id TEXT PK
  room_id TEXT FK
  agent_id TEXT FK
  round_number INT
  phase TEXT (propose/critique/rebut/vote)
  content TEXT
  responds_to_id TEXT FK (self-ref for threading)

agent_personas          -- Personality data
  agent_id TEXT PK FK
  ocean_scores TEXT (JSON: {O,C,E,A,N})
  emotional_state TEXT (JSON: {valence, arousal})
  cognitive_biases TEXT (JSON array)
  updated_at TEXT

agent_relationships     -- Pairwise trust
  agent_a_id TEXT FK
  agent_b_id TEXT FK
  trust_score REAL
  interaction_count INT
  last_interaction TEXT
  PK (agent_a_id, agent_b_id)

message_mentions        -- @mention routing
  id TEXT PK
  message_id TEXT FK
  mentioned_agent_id TEXT FK
  mention_type TEXT (direct/team/broadcast)

agent_scaling_events    -- Hire/scale history
  id TEXT PK
  event_type TEXT (hire_request/spawn/scale_down)
  requesting_agent_id TEXT FK
  template_id TEXT
  metrics_snapshot TEXT (JSON)
  approved_by TEXT
  created_at TEXT

agent_templates         -- Spawn templates
  id TEXT PK
  name TEXT
  role TEXT
  persona_config TEXT (JSON)
  tools TEXT (JSON array)
  llm_tier TEXT
  created_at TEXT
```

### SSE Event Types (New)

```
spatial:position_updated    -- Agent moved on canvas
workflow:phase_started      -- Phase began execution
workflow:phase_completed    -- Phase finished with artifact
workflow:phase_failed       -- Phase failed validation
debate:round_started        -- New debate round began
debate:position_submitted   -- Agent submitted argument
debate:consensus_reached    -- Debate concluded
chat:mention_received       -- Agent was @mentioned
chat:agent_response         -- Agent responded to mention
scaling:hire_requested      -- Agent requested scaling
scaling:agent_spawned       -- New agent created from template
scaling:agent_decommissioned -- Idle agent removed
persona:state_updated       -- Emotional state changed
```

### API Routes (New, estimated)

```
Spatial (4):     GET/PUT /api/agents/[id]/position, GET /api/spatial/layout, POST /api/spatial/reset
Workflow (8):    CRUD templates, CRUD phases, POST execute, POST advance-phase, GET artifacts
Debate (6):      CRUD rooms, POST submit-position, POST cast-vote, GET argument-tree
Persona (4):     GET/PUT persona, GET/PUT relationships, GET trust-graph
Scaling (4):     POST hire-request, POST approve, GET templates, GET scaling-events
Chat ext (3):    GET mentions, POST resolve-mention, GET agent-responses
Total: ~29 new API routes
```

---

## Sources

### Primary Sources (Official Repos & Docs)
- [MetaGPT GitHub](https://github.com/FoundationAgents/MetaGPT) -- SOP pipeline, role definitions, artifact handoffs [HIGH]
- [ChatDev GitHub](https://github.com/OpenBMB/ChatDev) -- Chat chain architecture, phase design [HIGH]
- [TinyTroupe GitHub](https://github.com/microsoft/TinyTroupe) -- Persona simulation, Big Five, cognitive state [HIGH]
- [TinyTroupe API Docs](https://microsoft.github.io/TinyTroupe/api/tinytroupe/agent/index.html) -- TinyPerson class, mental faculties, memory [HIGH]
- [AI Town GitHub](https://github.com/a16z-infra/ai-town) -- Spatial world, PixiJS rendering, pathfinding [HIGH]
- [AI Town Architecture](https://github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md) -- Game loop, world model, conversation system [HIGH]
- [AutoGen Conversation Patterns](https://microsoft.github.io/autogen/0.2/docs/tutorial/conversation-patterns/) -- GroupChat, speaker selection [HIGH]
- [AutoGen Multi-Agent Debate](https://microsoft.github.io/autogen/stable//user-guide/core-user-guide/design-patterns/multi-agent-debate.html) -- Solver/aggregator pattern, majority voting [HIGH]
- [CrewAI Hierarchical Process](https://docs.crewai.com/en/learn/hierarchical-process) -- Manager delegation, task routing [HIGH]
- [CrewAI Flows](https://docs.crewai.com/en/concepts/flows) -- Event-driven execution, visualization [MEDIUM]
- [LangGraph Overview](https://docs.langchain.com/oss/python/langgraph/overview) -- State machine workflows, graph visualization [HIGH]
- [React Flow / @xyflow/react](https://reactflow.dev/examples) -- Node-based UI, animated edges, custom nodes [HIGH]
- [OpenClaw Multi-Agent Routing](https://docs.openclaw.ai/concepts/multi-agent) -- @mention patterns, deterministic routing [HIGH]

### Research Papers
- [MetaGPT Paper (ICLR 2024)](https://arxiv.org/abs/2308.00352) -- SOP framework, structured communication [HIGH]
- [ChatDev Paper (ACL 2024)](https://arxiv.org/abs/2307.07924) -- Chat chain, communicative dehallucination [HIGH]
- [Voting or Consensus in MAD](https://arxiv.org/abs/2502.19130) -- Voting vs consensus comparison, protocol effectiveness [MEDIUM]
- [AgentSpawn](https://arxiv.org/html/2602.07072) -- Dynamic agent spawning, memory transfer [MEDIUM]
- [Auto-scaling MAS (Frontiers)](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1638227/full) -- IAAG, DRTAG, evaluation metrics [MEDIUM]
- [EigenTrust](https://docs.openrank.com/reputation-algorithms/eigentrust) -- Trust score computation in networks [MEDIUM]

### Secondary Sources
- [n8n @Mention Workflow](https://n8n.io/workflows/3473-scalable-multi-agent-chat-using-mentions/) -- @mention routing pattern [MEDIUM]
- [AutoGen vs LangGraph vs CrewAI (2026)](https://dev.to/synsun/autogen-vs-langgraph-vs-crewai-which-agent-framework-actually-holds-up-in-2026-3fl8) -- Framework comparison [LOW]
- [Multi-Agent Scaling Guide](https://agenticaiguide.ai/ch_8/sec_8-3.html) -- Enterprise scaling patterns [MEDIUM]
- [Cognaptus TinyTroupe Analysis](https://cognaptus.com/blog/2025-07-15-personas-with-purpose-how-tinytroupe-reimagines-multiagent-simulation/) -- Persona simulation deep dive [MEDIUM]
- [IBM ChatDev Overview](https://www.ibm.com/think/topics/chatdev) -- ChatDev architecture summary [MEDIUM]
- [Debate-Based Consensus Implementation](https://medium.com/@edoardo.schepis/patterns-for-democratic-multi-agent-ai-debate-based-consensus-part-2-implementation-2348bf28f6a6) -- Democratic patterns for MAS [LOW]

---

*Feature research for: AI Multi-Agent Orchestration Platform (Mission Control)*
*Researched: 2026-03-15*
