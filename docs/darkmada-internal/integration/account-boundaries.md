# Account Boundaries

## Brief
> The MacBook Pro 48GB hosts three macOS user accounts. Jackson is admin and the only secret-holder. Mainframe
> hosts local models with no public-internet egress. SpiderMan runs the agent fleet. Cross-account calls go
> through MCP over loopback.

## Accounts

| Account | May do | May not do |
|---|---|---|
| **Jackson** (admin) | Hold secrets, sign approvals, run DarkMada client, review audit | Run agent processes, host long-lived services |
| **Mainframe** | Run Ollama, hold model weights, serve local inference over loopback | Make outbound public-internet calls, hold secrets |
| **SpiderMan** | Run agent processes, MCP services, n8n, observability | Hold secrets, write outside `/Users/spiderman/` and the data dir |

## Cross-account communication

- All cross-account calls go through the **MCP Core Gateway** on a loopback socket.
- The gateway authenticates with a per-process token issued at startup.
- No account has network share write access into another account's home.

## Phase 1 — Mac mini

- The Mac mini hosts SpiderMan and Mainframe as system users.
- The MacBook Pro keeps the Jackson account for operator work.
- The MCP gateway exposes a port over the WireGuard mesh; Jackson's MBP is the only Founder LAN client allowed in.

## Why this exists

A compromise of an agent process must not give the attacker the secrets. A compromise of a local model must
not give the attacker the public internet. A compromise of Jackson's machine must not give the attacker the
runtime. The accounts enforce this in the simplest possible way: file-system + process-table isolation.
