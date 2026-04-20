# MCP Role — what agents must do

## Brief
> Every agent in the DarkMada talks to the spine through the custom MCP layer. There is no other
> sanctioned channel. If you bypass MCP, you bypass the audit log, and the action is invalid.

## The eight services

1. **MCP Core Gateway** — auth + routing. Every call enters here.
2. **Memory API** — read/write Supabase memory tables.
3. **Context Loader** — assemble per-task system prompts with retrieved memory.
4. **Event Bus** — pub/sub for cross-agent messaging.
5. **Retrieval Layer** — hybrid (vector + keyword + recency) search.
6. **Session State Manager** — active conversation state.
7. **Agent Context Interface** — per-agent persona, skills, tool budget.
8. **Tool Access Layer** — brokered external tool use.

## Protocol invariants (for every call)

- Authenticated with the agent's process token (issued at spawn).
- Tagged with `tenant`, `actor`, `intent`.
- Returns a `call_id` that gets written to `audit_logs`.
- Cost (tokens, $$, wall-clock) is included in the response and propagates to the run record.

## Forbidden patterns

- Direct Postgres connections from an agent.
- Direct external HTTP from an agent (must go through Tool Access).
- Reading from the Obsidian vault as a source of facts (mirror only).
- Spawning subprocesses without a Tool Access grant.

## Adding a new MCP service

Process: spec in Idea Forge → Helmy approves scope → Skywalker writes spec → Seccy reviews boundary →
Skywalker implements → Skywalker ships behind a feature flag → soak for 1 week → flag flips on.
