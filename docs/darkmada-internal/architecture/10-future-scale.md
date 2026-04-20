# 10 — Future Modular Scale

The system is designed to grow one lane at a time. Nothing in Phase 0 needs to be rewritten to reach Phase 3 —
only the runtime topology changes.

## Phase 0 — Today

- MacBook Pro 48GB hosts everything (3 accounts).
- DarkMada + Atlas live in this repo.
- Local models via Ollama on Mainframe account.
- Telegram is the executive ingress.
- SQLite cache for DarkMada's local state.

## Phase 1 — Next

- **Mac mini** comes online as the always-on host. SpiderMan + Mainframe migrate over.
- **Real Supabase** project provisioned. Current SQLite mirrors into it (write-through).
- **MCP Core Gateway** extracted as a Node service with auth tokens per agent.
- **Obsidian mirror writer** ships behind a feature flag.

## Phase 2 — Expand

- **Edge VPS pool** behind WireGuard receives webhooks (n8n workers).
- **Work iPhone** joins the founder lane via VPN.
- **Secondary GPU node** added to the Mainframe account for larger local models.
- **Approvals** gain push-notification escalation paths (timeout → escalate to alternate channel).

## Phase 3 — Scale

- **Multi-tenant MCP gateway** — Helmy can spawn project-scoped subordinate agents.
- **Hot-standby Mac mini** as a peer; Postgres in primary/replica.
- **Public-facing presence** via reverse proxy + per-tool rate limits.
- **Optional Starlink** secondary uplink for resilience.

## What does *not* change

- The agent roster (Helmy, Thinky, Skywalker, Velma, Dr Strange, Seccy).
- The MCP service surface (8 services, same responsibilities).
- The source-of-truth rule (Supabase canonical, Obsidian mirror).
- The trust ladder (guest → edge → server → founder).
- DarkMada as the operator front door.
