# OpenClaw Deployment + Mission Control Setup (Current Working Pattern)

This document captures the working deployment model used in production-like OpenClaw environments.

## 1) Runtime persistence (critical)

Mission Control **must** use a stable DB path outside `.next/standalone`.

Required env:

```env
MISSION_CONTROL_DATA_DIR=/root/.openclaw/workspace/research/mission-control/.data
MISSION_CONTROL_DB_PATH=/root/.openclaw/workspace/research/mission-control/.data/mission-control.db
MISSION_CONTROL_TOKENS_PATH=/root/.openclaw/workspace/research/mission-control/.data/mission-control-tokens.json
```

Systemd should also set these explicitly to avoid drift.

## 2) Standalone build asset sync

When running `node .next/standalone/server.js`, static assets must exist under:

- `.next/standalone/.next/static`
- `.next/standalone/public`

Build step now includes a `prepare:standalone` sync to prevent broken login UI / missing CSS/JS.

## 3) OpenClaw integration model

- Agent catalog sync from `openclaw.json`
- Session scanning from `OPENCLAW_HOME/agents/*/sessions/sessions.json`
- Optional task mirroring from OpenClaw session-key conventions

### Identity aliasing

`main` runtime identity is aliased to `nova` in Mission Control for front-door UX.

## 4) Data safety for mirrored external tasks

Mirrored OpenClaw tasks can be intentionally deleted by users.

To prevent resurrection on next sync, Mission Control stores tombstones in:

- `external_task_tombstones(source, external_id, deleted_by, ...)`

Sync skips tombstoned external IDs.

## 5) Task workflow and approvals

Current enterprise statuses:

- inbox
- backlog
- todo
- in-progress
- review
- blocked
- needs-approval
- done

Approval gates:

- Main/high-level task `review -> done` requires explicit approval.
- External action tasks (`publish`, `email`, `webhook`, `external_call`) route to `needs-approval` until approved.

## 6) Office autopilot (continuous progress)

Scheduler task `office_autopilot`:

- triages inbox/backlog to Conductor (`todo` + assignment)
- detects blockers + approvals pending
- records decision cycles in `office_autopilot_runs`

## 7) Reliability defaults

Recommended settings:

- `general.auto_backup=true`
- `general.agent_heartbeat=true`
- `office.autopilot_enabled=true`
- `webhooks.retry_enabled=true`

## 8) Security note

Never commit secrets (`AUTH_PASS`, `API_KEY`, OAuth secrets, etc.).
Use `.env` only in deployment environment.
