# 06 — Automation: n8n's role

n8n is the **edge automation glue**. It is *not* an orchestrator — Thinky owns orchestration. n8n runs
schedules, fires webhooks, syncs external services, and delivers outputs.

## What n8n owns

- Cron schedules (e.g. morning brief at 06:30 Brisbane).
- Webhook receivers (incoming email, calendar updates, Telegram).
- Outbound delivery (post to Telegram, send email, write to Drive).
- Sync jobs (calendar pull, Notion → memory, Linear → tasks).

## What n8n does *not* own

- Agent orchestration. Thinky decides what runs and where.
- Memory writes. n8n calls Memory API; it never writes to Postgres directly.
- Approvals. n8n cannot execute an approval-gated action; it can only deliver one that's approved.

## Topology

```
external service → webhook → n8n receiver → MCP Event Bus → Thinky → agents → ... → MCP Tool Access → n8n delivery → external service
```

n8n sits at *both ends* of the loop. The middle is the DarkMada.

## Where n8n runs

Phase 0: optional, on the SpiderMan account.
Phase 1+: on the Mac mini, as a system service. Workers may be deployed to the edge VPS pool for high-volume
webhook ingest.
