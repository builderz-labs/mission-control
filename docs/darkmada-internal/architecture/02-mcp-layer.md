# 02 — Custom MCP Server Layer

The MCP layer is the *only* sanctioned channel between agents and the spine. Every memory read, every tool call,
every cross-agent message goes through it. This is what makes the audit log trustworthy and the security posture
defensible.

## Services

| Service | Responsibility | Consumers |
|---|---|---|
| **MCP Core Gateway** | Auth, tenant routing, rate limiting | All agents |
| **Memory API** | CRUD over Supabase memory tables; pgvector retrieval | Dr Strange, Helmy, Velma |
| **Context Loader** | Per-task system prompt assembly + retrieved memory injection | Thinky |
| **Event Bus** | Pub/sub spine for cross-agent + DarkMada updates | All agents |
| **Retrieval Layer** | Hybrid (vector + keyword + recency) search | Velma, Dr Strange, Helmy |
| **Session State Manager** | Active conversations, agent-to-agent threads, checkpoints | Thinky, Helmy |
| **Agent Context Interface** | Per-agent persona, skills, tool budget | Thinky |
| **Tool Access Layer** | Brokered access to external tools with approval gates | Skywalker, Velma, Seccy |

## Invariants

1. **Every call is logged** to `audit_logs` with actor + tenant + intent + result + cost.
2. **No agent talks to Postgres directly.** Always via Memory API.
3. **Approval-gated tools cannot run** without a signed approval record from `approvals`.
4. **Tool credentials are short-lived.** Tool Access mints a 60-second signed token per call.

## Phase 0 (today)

The MCP layer is *documented* and *visualized* but not yet implemented as a separate process. Today, calls go
through DarkMada's API routes. Phase 1 extracts these into a Node service running on the SpiderMan
account.

## Future direction

Multi-tenant: Helmy can spawn project-scoped subordinate agents that get their own narrow MCP scope. The Core
Gateway enforces the boundary.
