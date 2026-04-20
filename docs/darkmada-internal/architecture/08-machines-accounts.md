# 08 — Machines + Accounts

## The MacBook Pro 48GB (Phase 0 host)

Three macOS user accounts isolate concerns. This is the most important physical-layer decision in Phase 0.

| Account | Purpose | Responsibilities |
|---|---|---|
| **Jackson** (admin) | Founder / approvals / control | Approvals, secrets unlock, identity owner, final calls |
| **Mainframe** | Local models / Ollama / offline compute | Qwen 3.5, GLM 4.6, Nemotron, MiniMax 2.5, embeddings |
| **SpiderMan** | Runtime / agents / Helmy + Thinky operations | Node services, MCP servers, n8n triggers, observability |

## Account boundary rule

- Jackson **never** runs agent processes.
- SpiderMan **never** holds secrets.
- Mainframe **never** speaks to the public internet directly.
- Cross-account calls go through the MCP gateway over loopback (or WireGuard once the Mac mini is online).

## Edge devices

| Device | Purpose | Trust |
|---|---|---|
| iPhone 15 Pro Max | Telegram executive ingress + push approvals | founder |
| Work iPhone (future) | Carrier-isolated work line for high-trust comms | founder |

## Future hosts

| Host | When | Purpose |
|---|---|---|
| Mac mini (M4 Pro 48GB) | Phase 1 | Always-on host for SpiderMan + Mainframe accounts |
| Edge VPS pool | Phase 2 | Public-facing webhook receivers, n8n workers |
| Secondary GPU node | Phase 2 | Larger local models |
| Hot-standby Mac mini | Phase 3 | Peer with primary; Postgres replica |

See `10-future-scale.md` for the staged rollout.
