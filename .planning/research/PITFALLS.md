# Pitfalls Research

**Domain:** AI Multi-Agent Orchestration Platform (Mission Control)
**Researched:** 2026-03-15
**Confidence:** MEDIUM-HIGH (mix of peer-reviewed research, production post-mortems, and community experience)

---

## Critical Pitfalls

### P1: The 17x Error Amplification Trap ("Bag of Agents")

**What goes wrong:**
Small errors compound exponentially across agents. A minor misinterpretation by Agent A becomes a confident but wrong input to Agent B, which Agent C treats as ground truth. The MAST taxonomy (Multi-Agent System Failure Taxonomy) identified 14 unique failure modes across 1,642 execution traces in 7 frameworks. Research shows 41-86.7% of multi-agent LLM systems fail in production, with 79% of failures originating from specification and coordination issues, not technical implementation.

**Why it happens:**
Developers treat agents like microservices that "just work" and assume LLM outputs are reliable inputs for downstream agents. The "bag of agents" anti-pattern -- every agent talking to every other agent with no hierarchy, no gatekeeper, no schema enforcement -- creates N^2 communication paths where errors propagate freely.

**How to avoid:**
- Implement a centralized control plane (orchestrator) that validates all inter-agent messages
- Use typed schemas with discriminated unions for all agent outputs (not free-form text)
- Treat agent boundaries like API contracts: validate inputs, validate outputs, reject on schema violation
- Cap agent count: coordination gains plateau beyond 4 agents in structured systems; above that, overhead consumes benefits
- Implement retrieval tools (prevent hallucination), schema validators (prevent silent failures), budget meters (prevent runaway loops), and permission gates (prevent unsafe side effects)

**Warning signs:**
- Agents producing "confident nonsense" -- well-formatted but factually wrong outputs
- Debugging requires tracing through 3+ agents to find root cause
- Agent outputs contain fields or formats not in the original specification
- Test suite passes with mocked agents but fails with real LLM responses

**Phase to address:** Phase 1 (Spatial Visualization) and Phase 2 (Workflow Engine) -- establish the control plane and schema validation before building complex multi-agent features

**Recovery cost:** HIGH -- requires retrofitting validation layers across all agent communication paths

**Confidence:** HIGH -- peer-reviewed research (arXiv:2503.13657), GitHub Blog engineering post, Towards Data Science analysis

---

### P2: SSE Connection Exhaustion and Silent Failure

**What goes wrong:**
SSE connections silently fail in production -- proxies buffer responses, connections drop without client notification, and the 6-connection-per-domain limit in HTTP/1.1 locks users out when they open multiple tabs. At ~1,000 concurrent connections (MC's current file descriptor limit), the system silently stops accepting new subscribers. Real-time agent state updates stop flowing but no error is surfaced.

**Why it happens:**
SSE opens a stream with no content length; any intermediate proxy can legally buffer packets and wait for the stream to close before forwarding. Automatic SSE reconnection can take 30+ seconds. Without HTTP/2 multiplexing, each SSE connection consumes a dedicated TCP connection. Mission Control's lack of a global error boundary (error.tsx missing) means connection failures go undetected by the UI.

**How to avoid:**
- Implement SSE connection health checks with heartbeat pings (every 15-30 seconds)
- Add a handshake mechanism to verify the SSE connection is actually delivering events; fall back to polling if handshake fails within timeout
- Use HTTP/2 to multiplex SSE streams over a single TCP connection (eliminates the 6-connection browser limit)
- Implement connection pooling: one SSE connection per client that multiplexes multiple event types, not one connection per feature
- Set explicit `ulimit -n` and monitor file descriptor usage; alert at 80% capacity
- Add client-side reconnection with exponential backoff and jitter (not the browser's default reconnection)
- Add the missing global error boundary (error.tsx + global-error.tsx) to surface connection failures

**Warning signs:**
- Users report "stale" data that updates only on page refresh
- SSE connection count grows linearly with features enabled per user
- Development works fine but staging/production behind nginx breaks
- No errors in logs but clients are not receiving events

**Phase to address:** Phase 0 (Foundation) -- fix before any real-time features are built on SSE

**Recovery cost:** MEDIUM -- requires SSE infrastructure rewrite but not feature logic changes

**Confidence:** HIGH -- dev.to post-mortem with 1,000+ reactions, MDN documentation, production reports from Shopify/Split at scale

---

### P3: Zustand Monolithic Store Re-render Storms

**What goes wrong:**
The current 1,146-line Zustand store causes cascading re-renders when any state changes. With spatial visualization (50+ nodes animating), workflow engine state updates, chat messages arriving, and debate rounds progressing -- all in one store -- every state change triggers selector re-evaluation across the entire app. Components subscribed to unrelated slices re-render because selectors return new object references.

**Why it happens:**
Zustand uses strict equality (`===`) for change detection. Selectors that return new objects (`{ a: state.a, b: state.b }`) create new references on every call, causing re-renders even when values are unchanged. In a monolithic store, unrelated state updates trigger all subscriptions to re-evaluate. React Flow nodes subscribing to store state re-render on every unrelated change, dropping from 60fps to <10fps.

**How to avoid:**
- Split the store into domain-specific stores: `useSpatialStore`, `useWorkflowStore`, `useDebateStore`, `useChatStore`, `useAgentStore`
- Use atomic selectors (select one primitive at a time) instead of object selectors
- Use `useShallow` from Zustand for any multi-value selections
- Keep transient/animation state (node positions during drag, SSE streaming text) in component-local state or refs, not Zustand
- React Flow specifically: use uncontrolled flow mode (`defaultNodes`/`defaultEdges`) for performance, let React Flow manage internal state

**Warning signs:**
- React DevTools Profiler shows components re-rendering that should not be affected by the state change
- Animation frame rate drops below 30fps during state updates
- Adding a new feature to the store causes unrelated features to slow down
- `useStore(state => ({ ...multipleFields }))` pattern without `useShallow`

**Phase to address:** Phase 0 (Foundation) -- store decomposition must happen before features add more state

**Recovery cost:** HIGH -- touching 33 panels and all store consumers; must be done incrementally with tests

**Confidence:** HIGH -- Zustand GitHub discussions #2496, #3153, #2642; official documentation; React Flow performance guide

---

### P4: SQLite Write Contention During Concurrent Phase Transitions

**What goes wrong:**
Multiple agents attempting phase transitions, artifact saves, or status updates simultaneously hit SQLite's single-writer lock. Even with WAL mode and busy_timeout, concurrent writes serialize at the database level. During a workflow with parallel phases, 5 agents completing simultaneously all try to write their results -- 4 get SQLITE_BUSY. With the default 5-second busy_timeout, agents appear to hang. Without proper retry logic, transitions are lost.

**Why it happens:**
SQLite uses database-level locking, not row-level. WAL mode allows concurrent reads during writes but still serializes all writes. `better-sqlite3` is synchronous -- a write that blocks also blocks the Node.js event loop, preventing SSE heartbeats and HTTP responses. Developers test with 1-2 agents and never see contention; production runs 5+ concurrent agents.

**How to avoid:**
- Implement a write queue: serialize all database writes through a single async queue (FIFO)
- Use `BEGIN IMMEDIATE` for write transactions so contention is detected at transaction start, not at commit time
- Batch writes: if the queue has multiple pending writes, wrap them in a single transaction
- Set `busy_timeout` to at least 5000ms and add application-level retry with exponential backoff
- Move write-heavy operations (chat messages, agent logs) to a separate SQLite database file to reduce contention on the main workflow database
- Monitor write queue depth; alert if it exceeds 50 pending operations

**Warning signs:**
- Sporadic SQLITE_BUSY errors in logs under load
- Phase transitions occasionally "disappear" (write failed silently)
- SSE heartbeats lag during batch operations
- Agent status updates arrive out of order

**Phase to address:** Phase 2 (Workflow Engine) -- critical for parallel phase execution

**Recovery cost:** MEDIUM -- write queue is an additive change; batching requires transaction boundary redesign

**Confidence:** HIGH -- SQLite documentation, bugsink.com production experience, tenthousandmeters.com deep-dive, better-sqlite3 documentation

---

### P5: LLM Debate Cost Explosion and Infinite Loops

**What goes wrong:**
Token costs multiply as N agents x M rounds x context_length. A debate with 4 agents over 5 rounds, each carrying full conversation history, can burn 3.5x the tokens of a single-agent approach -- with no accuracy improvement. Research shows MAD (Multi-Agent Debate) frequently fails to outperform single-agent Chain-of-Thought. Worse: agents can enter infinite loops debating the same point, with one documented case burning $47,000 over 4 weeks from an undetected loop between two agents.

**Why it happens:**
Each debate round passes the full conversation history to every participant, and context windows grow linearly per round. Without a convergence check, agents can "agree to disagree" indefinitely. Moderator agents can enter their own loops when they cannot resolve disagreements. Cost monitoring is often added as an afterthought. Research shows MAD methods frequently reverse correct answers into incorrect ones -- they are "overly aggressive" at changing positions.

**How to avoid:**
- Implement triple circuit breakers: (1) max rounds (3-5), (2) token budget per debate (hard ceiling before start), (3) cost ceiling per session
- Add convergence detection: after each round, compare agent outputs; halt if similarity exceeds threshold (Beta-Binomial stability monitoring)
- Use S2-MAD approach: similarity calculation + redundancy filtering + selective participation cuts tokens by up to 94.5% with <2% accuracy loss
- Implement a judge/moderator with its own iteration limit (not unlimited retries)
- Default to majority vote on non-convergence rather than additional rounds
- Log and alert on debates exceeding 3 rounds -- most productive debates converge in 2-3 rounds
- Consider that MAD only reliably improves accuracy when mixing different foundation models (e.g., GPT-4o + Llama-70b); same-model debates often degrade accuracy

**Warning signs:**
- Token usage per debate trending upward over time
- Debates consistently hitting max rounds without convergence
- Moderator agent making the same "try again" request repeatedly
- Cost per debate exceeding 3x the single-agent equivalent

**Phase to address:** Phase 3 (Debate Rooms) -- circuit breakers must be in the initial implementation, not added later

**Recovery cost:** LOW (if circuit breakers exist) / HIGH (if cost is already spiraling -- requires debate redesign)

**Confidence:** HIGH -- ICLR 2025 blogpost benchmarks, S2-MAD paper (NAACL 2025), multiple post-mortems documenting $40+ burns in minutes

---

### P6: Persona Drift and OCEAN Score Oscillation

**What goes wrong:**
After 8-12 dialogue turns, persona self-consistency degrades by >30% even with full context. The agent loses its assigned personality and begins adopting the persona of whichever agent it interacts with most. OCEAN scores oscillate because LLMs have no persistent internal state -- each turn is a fresh inference conditioned on increasingly long (and eventually truncated) context. Larger models experience greater identity drift.

**Why it happens:**
OCEAN personality frameworks were designed for humans; porting them to LLMs creates an "ontological error" -- item-factor loadings and latent constructs in humans do not transfer invariantly to LLMs. Persona prompts account for less than 10% of annotation variance on subjective tasks. As conversation history grows and gets truncated, the persona grounding in the system prompt loses influence relative to recent conversation content.

**How to avoid:**
- Implement persona anchoring: re-inject persona summary every N turns (not just in system prompt)
- Use 3-metric consistency monitoring: prompt-to-line (alignment with persona), line-to-line (internal consistency), Q&A (stable beliefs over time)
- Set persona "guard rails" with hard constraints (e.g., "NEVER agree with X" for a contrarian persona) not just soft descriptions
- Keep OCEAN scores as discrete levels (LOW/MED/HIGH) not continuous floats -- prevents meaningless oscillation
- Implement emotional state as a finite state machine with explicit transition rules, not free-form LLM generation
- Cap conversation history to most recent N turns + persona summary, rather than full history
- Validate persona consistency periodically with automated consistency checks

**Warning signs:**
- Agent responses become generic/bland over long conversations
- Two agents with different personas producing near-identical responses
- OCEAN scores changing by >1 standard deviation between consecutive interactions
- Emotional state flipping between extremes (happy->angry->happy) within 3 turns

**Phase to address:** Phase 4 (Deep Persona Simulation) -- must be tested with multi-turn conversations, not just single-prompt demos

**Recovery cost:** MEDIUM -- persona system redesign but conversation logic can be preserved

**Confidence:** MEDIUM -- arXiv:2402.10962 (persona drift measurement), Cambridge personality manipulation study, PersonaLLM research; OCEAN-specific claims extrapolated from general persona research

---

### P7: Runaway Agent Spawning (Fork Bomb)

**What goes wrong:**
An auto-scaling system that allows agents to spawn sub-agents can create exponential growth. Agent A spawns 3 helpers, each helper spawns 3 more -- within 4 levels that is 81 agents, each consuming LLM API calls, SSE connections, and database writes. Combined with the SQLite single-writer constraint and ~1,000 SSE connection limit, this crashes the system within minutes.

**Why it happens:**
Developers implement "spawn when overwhelmed" logic without recursion limits. The spawning agent's workload metric (queue depth, response time) can trigger more spawns before previously spawned agents have finished initializing ("thundering herd"). Scale-down is harder than scale-up: orphaned agents that have lost their parent's SSE connection continue running with no coordination.

**How to avoid:**
- Hard cap spawn depth at 2-3 levels maximum
- Global agent count ceiling (e.g., 20 total active agents) enforced at the orchestrator level
- Rate limit spawning: max 1 new agent per 5 seconds per parent, with jitter
- Require explicit approval for any spawn beyond the initial team
- Implement agent lifecycle tracking: every agent has a parent_id, created_at, and TTL; reaper process kills agents exceeding TTL
- No automatic restart on crash -- mark as "ready" but require user re-engagement
- Add backpressure: if write queue depth exceeds threshold, reject new spawn requests with 503

**Warning signs:**
- Agent count growing faster than task count
- SSE connection count approaching file descriptor limit
- SQLite write queue depth spiking
- Agents spawning agents that have no tasks to perform

**Phase to address:** Phase 5 (Auto-Scaling) -- must be the final phase because it amplifies every other pitfall

**Recovery cost:** LOW (if caps exist -- just enforce them) / CRITICAL (if fork bomb already running -- requires manual kill and state reconciliation)

**Confidence:** HIGH -- OpenClaw issue #17511 (nested spawning limits), AgentSpawn paper (depth limit of 3), n8n max_iterations production fixes, AWS agentic security framework

---

### P8: @Mention Chat Message Routing Loops

**What goes wrong:**
Agent A @mentions Agent B for clarification. Agent B's response @mentions Agent A for confirmation. This creates an infinite ping-pong that fills the chat history, consumes LLM tokens, and triggers SSE fan-out to all subscribers. With N agents in a room, a single misrouted @mention can cascade into N*(N-1) message exchanges per round.

**Why it happens:**
Agents are instructed to "respond when mentioned" without a termination condition. The mention-detection regex is too broad (picks up agent names in quoted text or conversation history). No distinction between "direct request" and "informational mention." Chat history grows unboundedly, eventually exceeding context windows or SQLite storage expectations.

**How to avoid:**
- Implement conversation turn limits per thread: max 3 agent-to-agent exchanges before requiring human input
- Distinguish mention types: `@agent-request` (expects response) vs `@agent-info` (no response needed)
- Add duplicate detection: if an agent is about to send a message substantially similar to its last 2 messages, suppress it
- Implement cooldown: an agent can only respond to the same agent once per 30 seconds
- Use a message deduplication window (hash of sender + recipient + content similarity)
- Cap chat history sent to LLM: last 20 messages + thread summary, not full history
- SSE fan-out optimization: batch messages into 100ms windows instead of sending each individually

**Warning signs:**
- Chat rooms with >50 messages from agents within a minute
- Two agents exchanging nearly identical messages
- SSE event queue growing faster than it drains
- Token usage per chat room exceeding single-agent equivalents by >5x

**Phase to address:** Phase 6 (@Mention Chat) -- loop prevention must be in the initial message router, not added after launch

**Recovery cost:** LOW -- add circuit breaker to message router; no data migration needed

**Confidence:** MEDIUM -- extrapolated from chat bot governance failures and LLM tool-calling infinite loop research; limited direct post-mortems for agent-to-agent chat specifically

---

### P9: React Flow Memory Leaks from SSE + Animation

**What goes wrong:**
Each node in the spatial visualization subscribes to SSE events for real-time status updates. When nodes are removed from the flow (agent terminated, workflow complete), the SSE subscription is not cleaned up. Over time, memory consumption grows to 5+ GB, causing the browser tab to crash. Additionally, custom node components with complex CSS (shadows, gradients, animations) combined with frequent re-renders drop frame rates to <2 FPS.

**Why it happens:**
React Flow's `useEffect` cleanup functions are not properly tied to SSE `EventSource.close()`. Nodes that are off-screen but still in the nodes array continue to animate and subscribe. React Flow v11+ has documented memory leak issues during zoom/resize operations (GitHub issues #4943, #4973). Developers add "real-time" animation to every node without considering that 50 simultaneous CSS animations overwhelm the rendering pipeline.

**How to avoid:**
- Centralize SSE subscriptions: one connection per client, dispatch events to nodes via a lightweight event bus (not one EventSource per node)
- Implement strict `useEffect` cleanup: every SSE subscription must have a corresponding `EventSource.close()` in the cleanup function
- Use `AbortController` for fetch-based SSE to cancel on unmount
- Enable `onlyRenderVisibleElements` on the ReactFlow component (viewport culling)
- Use `snapToGrid={true}` with `snapGrid={[25, 25]}` to reduce state update frequency during drag
- Minimize CSS complexity on nodes: no box-shadows, no complex gradients, no CSS animations; use transform-based transitions only
- Memoize all custom node and edge components with `React.memo`
- Profile memory with Chrome DevTools after 30 minutes of use, not just initial load

**Warning signs:**
- Browser memory usage climbing steadily over time (visible in Task Manager)
- Frame rate drops during zoom/pan even with few nodes
- Console warnings about memory pressure
- SSE connections accumulating (visible in Network tab) beyond active node count

**Phase to address:** Phase 1 (Spatial Visualization) -- architecture must account for SSE lifecycle from day one

**Recovery cost:** MEDIUM -- requires refactoring SSE subscription model but not the visual components themselves

**Confidence:** HIGH -- xyflow GitHub issues #4943, #4973, #4711; React Flow official performance guide; freecodecamp memory leak patterns

---

### P10: Mega-Component Paralysis (Existing Tech Debt)

**What goes wrong:**
The 8 existing mega-components (agent-detail-tabs: 2,951 lines, office-panel: 2,411, task-board: 2,222) become the integration points for new features. Each new feature adds more state, more event handlers, and more conditional rendering to already-unmaintainable files. Bug fixes in one section break behavior in another because shared state and tangled dependencies make changes unpredictable. New developers cannot onboard to these files.

**Why it happens:**
Each feature was "just one more thing" added to the existing component. Creating sub-render methods within the same file gives the illusion of decomposition but shares all state, props, and side effects. The 240 `any` type usages mean TypeScript cannot catch interface violations during refactoring. Without tests specifically covering component interactions, no one dares split the files.

**How to avoid:**
- Decompose before extending: before adding any new feature to a mega-component, extract at least one independent sub-component first
- Enforce a 500-line soft limit and 1,000-line hard limit per component file via ESLint rule
- Replace `any` types in integration points before building on them (prioritize the 8 mega-components)
- Extract business logic into plain TypeScript functions/hooks outside of React components
- Use composition pattern: new features should be separate components that compose via props/context, not inline additions

**Warning signs:**
- PR diffs that touch >200 lines in a single component file
- Merge conflicts in the same files across multiple feature branches
- Bug fixes requiring understanding of >1,000 lines of context
- New team members avoiding certain files entirely

**Phase to address:** Phase 0 (Foundation) -- must decompose critical mega-components before building new features on top

**Recovery cost:** HIGH -- 2,951-line component requires careful incremental extraction with regression tests at each step

**Confidence:** HIGH -- well-established React best practices; code.pieces.app case study of 2,700-line refactoring; direct observation of Mission Control codebase

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `any` type for agent messages | Faster iteration on message formats | Silent type errors at agent boundaries; 240 instances already exist | Never in production -- use discriminated unions |
| Full conversation history in LLM context | Simple implementation, no summarization logic | Token costs scale linearly per turn; context window exceeded | Only for conversations <10 turns |
| One SSE connection per feature | Simple subscription model per component | File descriptor exhaustion at ~1,000 connections | Never -- multiplex from day one |
| SQLite for everything (chat + workflow + agents) | Single database, simple deployment | Write contention blocks all features simultaneously | Acceptable if write queue implemented; split databases for high-volume tables |
| Monolithic Zustand store | Easy cross-feature state access | Re-render storms, impossible to profile performance | Only during prototyping; split before beta |
| Client-side agent state polling (fallback) | Works when SSE fails | N requests/second x N agents = server overload | Only as SSE fallback with aggressive caching (30s+ intervals) |
| Storing OCEAN as continuous floats | Granular personality expression | Meaningless precision; drift appears as random oscillation | Never -- use discrete levels (5-point scale max) |
| No write queue for SQLite | Simpler code path | SQLITE_BUSY under load, lost writes | Only if <3 concurrent agents guaranteed |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| @xyflow/react + Zustand | Storing all node/edge state in Zustand, causing full re-renders on every drag | Use React Flow's internal state (uncontrolled mode) for position/selection; sync to Zustand only on significant events (drop, connect, delete) |
| SSE + Next.js App Router | Using Route Handlers for SSE without proper streaming setup | Use `ReadableStream` in Route Handler with proper `Content-Type: text/event-stream` headers; ensure no middleware buffers the response |
| better-sqlite3 + concurrent requests | Opening multiple database connections assuming parallel writes | Use a single connection with `BEGIN IMMEDIATE` and a write queue; multiple read connections are fine with WAL |
| LLM API + debate rounds | Sending full conversation history each round | Implement sliding window (last N messages) + summarization; use S2-MAD redundancy filtering |
| React Flow + SSE events | Creating one EventSource per custom node component | Create one EventSource at the provider level; dispatch events via React context or lightweight pub/sub |
| Next.js error.tsx + SSE | Assuming error.tsx catches SSE connection failures | SSE failures are not rendering errors; implement explicit connection monitoring with client-side error state |
| Zustand + React.memo | Assuming React.memo prevents Zustand-triggered re-renders | React.memo only prevents prop-change re-renders; Zustand hook subscriptions bypass memo. Use atomic selectors inside memoized components |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| SSE fan-out to N agents in chat | CPU spike on every message; response latency increases linearly with agent count | Batch SSE events into 100ms windows; use message-level routing (only send to mentioned agents) | >10 agents in a single chat room |
| React Flow re-render on Zustand state change | FPS drops during node animation; visible jank when moving nodes | Isolate spatial state from app state; use `onlyRenderVisibleElements`; `React.memo` all node components | >50 nodes with any Zustand subscription |
| Full conversation history in LLM context | Debate round time increases exponentially; token costs 3.5x+ baseline | Sliding window (last 20 messages) + periodic summarization; cap context to 4k tokens for debate | >5 debate rounds or >10 agents in conversation |
| SQLite write serialization | Phase transitions queued behind chat message inserts; UI shows stale state | Write queue with priority levels (workflow > chat > logs); separate SQLite files for high-volume tables | >5 concurrent writing agents |
| CSS animations on React Flow nodes | Frame rate <10 FPS during pan/zoom with animated nodes | Use CSS `transform` only (GPU-accelerated); disable animations during pan/zoom; use `will-change` sparingly | >20 nodes with box-shadow or gradient animations |
| Unbounded agent spawn rate | SSE connections exhaust file descriptors; SQLite write queue grows unboundedly | Global agent cap (20); spawn rate limit (1/5s); TTL with reaper | Any auto-scaling trigger without caps |
| Selector object creation in Zustand | Every component re-renders on every state change | Use atomic selectors or `useShallow`; never `(state) => ({ a: state.a, b: state.b })` without `useShallow` | >10 components subscribing to the same store |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| No token budget limits on debate/chat | Runaway LLM costs ($47,000 in one documented case) | Hard per-session and per-debate token budgets enforced at orchestrator level, not agent level |
| Agents with unrestricted tool access | Agent spawns shell commands, reads files, or accesses APIs it should not | Scope-based tool access: each agent type has an explicit allowlist of permitted actions |
| Persona prompts containing user data | Prompt injection through persona fields (name, bio) that contain malicious instructions | Sanitize all user-provided persona fields; separate user content from system instructions |
| SSE endpoints without authentication | Anyone can subscribe to agent state streams | Authenticate SSE connections with session tokens; validate on connection and periodically |
| No rate limiting on @mention processing | Adversarial user triggers agent storm via rapid @mentions | Rate limit: max 10 @mentions per minute per user; cooldown on agent responses |
| Chat history accessible across sessions | Previous conversation context leaks between different workflows | Scope chat history to workflow/room ID; clear on workflow completion |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing raw agent-to-agent messages in chat | Users overwhelmed by volume; cannot find human-relevant information | Separate "agent activity" feed from "user conversation"; collapse agent-to-agent exchanges |
| Real-time node animation without user control | Constant movement is distracting; users cannot focus on specific agents | Provide pause/play controls; only animate on state change, not continuously |
| Debate rounds displayed in real-time | Users watch agents argue for minutes with no actionable information | Show debate summary with expandable rounds; indicate progress (round 2/5) |
| OCEAN scores shown as precise decimals | Users see "Openness: 0.7234" and have no intuition for what it means | Use descriptive labels: "High Openness", "Moderate Conscientiousness"; 5-point visual scale |
| Auto-scaling shown as raw metrics | "Queue depth: 47, Active agents: 12" means nothing to non-technical users | Use natural language: "System is handling high load -- 12 agents working on 47 tasks" |
| No loading state during LLM responses | Agent nodes appear frozen; users click repeatedly or refresh | Show typing indicators on nodes; pulse animation during processing; estimated time remaining |
| Error messages from SQLite surfaced to users | "SQLITE_BUSY: database is locked" in UI | Translate to "System is processing -- your changes will appear shortly"; retry automatically |

## "Looks Done But Isn't" Checklist

- [ ] **SSE Subscriptions:** Often missing cleanup on component unmount -- verify `EventSource.close()` in every `useEffect` cleanup; check with React DevTools that connection count matches active components
- [ ] **Debate Convergence:** Often missing non-convergence handler -- verify what happens when agents never agree after max rounds; test with deliberately contradictory agents
- [ ] **SQLite Write Queue:** Often missing backpressure -- verify behavior when queue exceeds capacity; test with 10 concurrent writers
- [ ] **React Flow Memoization:** Often missing `React.memo` on custom nodes/edges -- verify with React DevTools Profiler that node A does not re-render when node B moves
- [ ] **Agent Spawn Limits:** Often missing the recursive case -- verify that Agent B spawned by Agent A cannot spawn Agent C beyond depth limit; test with spawn-happy agent prompt
- [ ] **Token Budget Enforcement:** Often missing enforcement at the RIGHT level -- verify budget is checked before LLM call, not after; verify budget survives agent restarts
- [ ] **Persona Consistency:** Often "tested" with 2-turn conversations -- verify persona holds after 15+ turns; test with adversarial conversation partner that tries to shift persona
- [ ] **Error Boundary Coverage:** Often missing `global-error.tsx` -- verify errors in root layout are caught; verify error UI includes `<html>` and `<body>` tags
- [ ] **Chat Deduplication:** Often missing the "similar but not identical" case -- verify agents cannot rephrase the same message to bypass dedup; test similarity threshold
- [ ] **Auto-Scale Cooldown:** Often missing the scale-down path -- verify orphaned agents are properly terminated; test by killing the parent agent mid-workflow
- [ ] **Write Contention Under Load:** Often "tested" with sequential requests -- verify with 5+ concurrent workflow transitions; use SQLite's `.trace()` to confirm no SQLITE_BUSY leaks
- [ ] **HTTP/2 for SSE:** Often assumed from nginx config alone -- verify actual protocol with browser DevTools Network tab; test with HTTP/1.1 fallback path

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| 17x Error Amplification | HIGH | 1. Add schema validation at every agent boundary 2. Implement output logging for all agent exchanges 3. Add integration tests with real (not mocked) LLM responses 4. Retrofit orchestrator as message broker |
| SSE Connection Exhaustion | MEDIUM | 1. Implement connection multiplexing (one SSE per client) 2. Add heartbeat monitoring 3. Implement polling fallback 4. Deploy behind HTTP/2-capable reverse proxy |
| Zustand Re-render Storms | HIGH | 1. Profile with React DevTools to identify worst offenders 2. Extract domain stores one at a time (start with most independent) 3. Replace object selectors with atomic selectors 4. Add `useShallow` where multi-select is needed |
| SQLite Write Contention | MEDIUM | 1. Add write queue as middleware layer 2. Set `busy_timeout = 5000` immediately 3. Use `BEGIN IMMEDIATE` for write transactions 4. Consider splitting chat/logs to separate SQLite file |
| Debate Cost Explosion | LOW-MEDIUM | 1. Add hard token budget (immediate) 2. Add round limit (immediate) 3. Implement convergence detection (next sprint) 4. Switch to S2-MAD redundancy filtering (later) |
| Persona Drift | MEDIUM | 1. Add persona re-injection every 5 turns 2. Implement consistency monitoring 3. Switch OCEAN from float to discrete levels 4. Add emotional state machine with transition rules |
| Runaway Agent Spawning | LOW-CRITICAL | If caught early: enforce caps. If fork bomb active: 1. Kill all agents via database flag 2. Clear spawn queue 3. Reconcile orphaned state 4. Add caps before re-enabling |
| Chat Message Loops | LOW | 1. Add per-thread turn limit 2. Add cooldown timer 3. Add similarity deduplication 4. Separate agent-to-agent from user-visible chat |
| React Flow Memory Leaks | MEDIUM | 1. Centralize SSE subscriptions 2. Audit all useEffect cleanup functions 3. Enable viewport culling 4. Profile memory over 30-minute session |
| Mega-Component Tech Debt | HIGH | 1. Add component-level tests before splitting 2. Extract one sub-component per PR 3. Replace `any` types in extracted interfaces 4. Enforce line limit going forward |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| P1: 17x Error Amplification | Phase 0 (Foundation) | Schema validation tests pass for all agent message types; no `any` types in agent interfaces |
| P2: SSE Connection Exhaustion | Phase 0 (Foundation) | Connection count stays constant regardless of features enabled; heartbeat monitoring dashboard shows all connections healthy |
| P3: Zustand Re-render Storms | Phase 0 (Foundation) | React DevTools Profiler shows 0 unnecessary re-renders during spatial visualization drag; store split into >=4 domain stores |
| P4: SQLite Write Contention | Phase 2 (Workflow Engine) | Load test with 10 concurrent writers shows 0 SQLITE_BUSY errors; write queue depth stays <20 under load |
| P5: Debate Cost Explosion | Phase 3 (Debate Rooms) | No debate exceeds token budget; convergence achieved in <=3 rounds for >80% of debates; circuit breaker triggers logged and alerted |
| P6: Persona Drift | Phase 4 (Persona Simulation) | Consistency metrics (prompt-to-line, line-to-line, Q&A) stay within 1 std dev over 20-turn conversations |
| P7: Runaway Agent Spawning | Phase 5 (Auto-Scaling) | Chaos test: agent instructed to "spawn as many helpers as needed" stays within global cap; orphan count stays 0 after scale-down |
| P8: Chat Message Loops | Phase 6 (@Mention Chat) | Two agents @mentioning each other cannot exceed 3 exchanges without human intervention; no duplicate messages in 60-second window |
| P9: React Flow Memory Leaks | Phase 1 (Spatial Visualization) | Browser memory stays <500MB after 60 minutes of use with 50 nodes; SSE connection count matches active node count exactly |
| P10: Mega-Component Tech Debt | Phase 0 (Foundation) | No component file exceeds 1,000 lines; all 8 mega-components have at least 1 extraction completed; `any` count reduced from 240 to <50 in integration points |

## MC-Specific Compound Risks

These pitfalls are not individually unique but their **combination** in Mission Control's stack creates amplified risks:

### Compound Risk 1: SSE + SQLite + Auto-Scaling
Each new agent needs: 1 SSE connection (limited to ~1,000) + write access (serialized through single writer) + monitoring (more Zustand state). Auto-scaling without awareness of these constraints creates a multiplicative failure: 20 agents = 20+ SSE connections + 20x write contention + 20 nodes re-rendering.

**Prevention:** Global resource budget tracked at orchestrator level. Before spawning an agent, check: SSE connections remaining, write queue depth, active node count. Reject spawn if any resource is at >80% capacity.

### Compound Risk 2: Debate + Chat + Token Costs
A debate room with @mention chat means every debate round potentially triggers chat notifications, which trigger agent responses, which add to debate context, which increases token usage per round. The three features amplify each other's costs.

**Prevention:** Strict feature isolation. Debate messages do not flow into chat. Chat @mentions do not trigger during active debate rounds. Token budgets are per-feature, not shared.

### Compound Risk 3: React Flow + Zustand + SSE Real-time Updates
Every SSE event updates Zustand state, which triggers React Flow node re-renders, which triggers layout recalculation. At 50 nodes with 2 SSE events/second, that is 100 state updates/second flowing through the monolithic store into the flow renderer.

**Prevention:** SSE events buffer into a batch (100ms window). Batched updates go to domain-specific Zustand store. React Flow reads from its own internal state; Zustand sync happens on requestAnimationFrame, not on every event.

## Sources

### Peer-Reviewed Research
- [Why Do Multi-Agent LLM Systems Fail? (MAST Taxonomy)](https://arxiv.org/abs/2503.13657) -- arXiv, March 2025. 14 failure modes across 1,642 traces. **HIGH confidence.**
- [S2-MAD: Breaking the Token Barrier](https://aclanthology.org/2025.naacl-long.475.pdf) -- NAACL 2025. 94.5% token reduction. **HIGH confidence.**
- [Multi-LLM-Agent Debate Scaling Challenges](https://d2jud02ci9yv69.cloudfront.net/2025-04-28-mad-159/blog/mad/) -- ICLR Blogposts 2025. MAD underperforms single-agent baselines. **HIGH confidence.**
- [Measuring and Controlling Persona Drift](https://arxiv.org/html/2402.10962v1) -- arXiv, 2024. 30%+ consistency degradation after 8-12 turns. **HIGH confidence.**
- [Examining Identity Drift in LLM Agents](https://arxiv.org/abs/2412.00804) -- arXiv, 2024. Larger models drift more. **MEDIUM confidence.**
- [Auto-scaling LLM-based Multi-Agent Systems](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1638227/full) -- Frontiers in AI, 2025. **MEDIUM confidence.**
- [Minimizing Hallucinations: Adversarial Debate and Voting](https://www.mdpi.com/2076-3417/15/7/3676) -- Applied Sciences, 2025. **MEDIUM confidence.**

### Engineering Post-Mortems and Guides
- [Multi-agent workflows often fail (GitHub Blog)](https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/) -- typed schemas, action schemas, MCP. **HIGH confidence.**
- [17x Error Trap of the "Bag of Agents" (Towards Data Science)](https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/) -- coordination saturation at 4 agents. **MEDIUM confidence.**
- [The Multi-Agent Trap (Towards Data Science)](https://towardsdatascience.com/the-multi-agent-trap/) -- cost and complexity warnings. **MEDIUM confidence.**
- [We Switched to a 5x Cheaper LLM (Gitar)](https://gitar.ai/blog/we-switched-to-a-5x-cheaper-llm-our-costs-went-up) -- cheaper model increased costs due to loops. **HIGH confidence.**
- [SSE Not Production Ready After a Decade (DEV Community)](https://dev.to/miketalbot/server-sent-events-are-still-not-production-ready-after-a-decade-a-lesson-for-me-a-warning-for-you-2gie) -- proxy buffering, silent failures. **HIGH confidence.**
- [Rate Limiting Your Own AI Agent (DEV Community)](https://dev.to/askpatrick/rate-limiting-your-own-ai-agent-the-runaway-loop-problem-nobody-talks-about-3dh2) -- $47K undetected loop. **HIGH confidence.**
- [LLM Tool-Calling Infinite Loop Failure Mode (Medium)](https://medium.com/@komalbaparmar007/llm-tool-calling-in-production-rate-limits-retries-and-the-infinite-loop-failure-mode-you-must-2a1e2a1e84c8) -- circuit breaker patterns. **MEDIUM confidence.**

### SQLite Production Experience
- [Abusing SQLite for Concurrency (SkyPilot)](https://blog.skypilot.co/abusing-sqlite-to-handle-concurrency/) -- write serialization patterns. **HIGH confidence.**
- [SQLite Concurrent Writes and "database is locked"](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/) -- deep dive on WAL mode limitations. **HIGH confidence.**
- [Single-writer Database Architecture (Bugsink)](https://www.bugsink.com/blog/database-transactions/) -- write queue pattern. **HIGH confidence.**
- [What to Do About SQLITE_BUSY Despite Timeout](https://berthub.eu/articles/posts/a-brief-post-on-sqlite3-database-locked-despite-timeout/) -- BEGIN IMMEDIATE recommendation. **HIGH confidence.**

### React Flow / @xyflow Performance
- [React Flow Performance Guide (Official)](https://reactflow.dev/learn/advanced-use/performance) -- memoization, viewport culling, snap-to-grid. **HIGH confidence.**
- [React Flow Optimization (DEV Community)](https://dev.to/usman_abdur_rehman/react-flowxyflow-optimization-45ik) -- FPS measurements with/without memo. **HIGH confidence.**
- [Memory Leak on React Flow (GitHub Issue #4943)](https://github.com/xyflow/xyflow/issues/4943) -- 5GB memory growth. **HIGH confidence.**
- [Scaling SSE to 28,000+ Connections](https://blog.pranshu-raj.me/posts/exploring-sse/) -- file descriptor limits, port exhaustion. **MEDIUM confidence.**

### Zustand Store Design
- [Zustand Multiple Stores Discussion (#2496)](https://github.com/pmndrs/zustand/discussions/2496) -- when to split. **HIGH confidence.**
- [Zustand Large Selectors Discussion (#3153)](https://github.com/pmndrs/zustand/discussions/3153) -- useShallow, atomic selectors. **HIGH confidence.**
- [Zustand Re-render Issues (#2642)](https://github.com/pmndrs/zustand/discussions/2642) -- object reference traps. **HIGH confidence.**
- [Working with Zustand (TkDodo)](https://tkdodo.eu/blog/working-with-zustand) -- best practices overview. **HIGH confidence.**

### Agent Orchestration Safety
- [OpenClaw Nested Spawning Issue (#17511)](https://github.com/openclaw/openclaw/issues/17511) -- depth limits for sub-agents. **MEDIUM confidence.**
- [AgentSpawn: Adaptive Multi-Agent Collaboration](https://arxiv.org/html/2602.07072) -- spawn depth capped at 3 levels. **MEDIUM confidence.**
- [Agentic AI Security Scoping Matrix (AWS)](https://aws.amazon.com/blogs/security/the-agentic-ai-security-scoping-matrix-a-framework-for-securing-autonomous-ai-systems/) -- behavioral monitoring, fail-safes. **HIGH confidence.**
- [Thundering Herd Problem Explained (Medium)](https://medium.com/@work.dhairya.singla/the-thundering-herd-problem-explained-causes-examples-and-solutions-7166b7e26c0c) -- jitter, coalescing, backpressure. **HIGH confidence.**

### Next.js Error Handling
- [Next.js Error Handling Docs (Official)](https://nextjs.org/docs/app/getting-started/error-handling) -- error.tsx vs global-error.tsx. **HIGH confidence.**
- [error.tsx vs global-error.tsx Discussion (#68048)](https://github.com/vercel/next.js/discussions/68048) -- layout errors not caught by error.tsx. **HIGH confidence.**

---
*Pitfalls research for: AI Multi-Agent Orchestration Platform (Mission Control)*
*Researched: 2026-03-15*
*Total pitfalls: 10 critical + 3 compound risks*
*Sources: 7 peer-reviewed papers, 8 engineering post-mortems, 4 SQLite production reports, 4 React Flow references, 4 Zustand discussions, 4 agent safety references, 2 Next.js references*
