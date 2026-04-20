# 09 — Network + Security Topology

## Segments

| Segment | CIDR | Trust | Members |
|---|---|---|---|
| Founder LAN | 10.10.10.0/24 | founder | MacBook Pro (Jackson account), iPhone 15 Pro Max |
| Server VLAN | 10.10.20.0/24 | server | Mac mini (future), MBP — SpiderMan, MBP — Mainframe |
| Edge / WireGuard | 10.10.30.0/24 | edge | Edge VPS pool, work iPhone |
| Guest WiFi | 10.10.99.0/24 | guest | Untrusted devices |

## Edge defenses

- **Firewall** (router): default-deny inbound, per-VLAN ACLs.
- **WireGuard mesh**: connects MBP, Mac mini, and edge VPS pool. Public services live behind it.
- **Starlink (optional)**: redundant uplink — failover only, never primary.
- **Approval gates**: Seccy holds the signing key for irreversible ops.
- **Audit log**: append-only, replicated off-host nightly.
- **Secret store**: Jackson account only; brokered via Tool Access MCP.

## Trust ladder

```
guest  →   edge  →   server  →   founder
  │         │          │            │
  │         │          │            └─ secrets, approvals, raw Postgres
  │         │          └─ runtime, models, MCP services
  │         └─ webhooks, n8n workers
  └─ untrusted devices
```

Cross-segment calls require an explicit allow rule. Defaults are deny.

## Operator practices

- WireGuard re-keys auto-rotated every 30 days (Seccy proposes; Jackson approves).
- All approvals on irreversible actions go to the Jackson iPhone via push (Telegram + APNs).
- The repo never holds production secrets — `.env.example` documents the shape only.
