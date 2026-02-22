# Mission Control

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D20-green)](https://nodejs.org/)

Web dashboard for monitoring and managing OpenClaw agent networks. Built with Next.js 16, React 19, and SQLite.

## Quick Start

```bash
# Install
pnpm install

# Copy and edit environment config
cp .env.example .env
# Edit .env with your values (see Environment Variables below)

# Development
pnpm dev          # http://localhost:3000

# Production
pnpm build
pnpm start        # http://0.0.0.0:3005
```

Initial login is seeded from `AUTH_USER` / `AUTH_PASS` on first run (only if the DB has no users yet).

## Architecture

```
mission-control/
├── middleware.ts              # Auth gate + network access control
├── src/
│   ├── app/
│   │   ├── page.tsx           # SPA shell - routes all panels via ContentRouter
│   │   ├── login/page.tsx     # Login page
│   │   └── api/               # 25+ REST API routes (see API Reference)
│   ├── components/
│   │   ├── layout/            # NavRail, HeaderBar, LiveFeed
│   │   ├── dashboard/         # Overview dashboard
│   │   ├── panels/            # 23 feature panels
│   │   └── chat/              # Agent chat UI
│   ├── lib/
│   │   ├── auth.ts            # Session + API key auth, RBAC
│   │   ├── config.ts          # Environment config
│   │   ├── db.ts              # SQLite (better-sqlite3, WAL mode)
│   │   ├── migrations.ts      # 11 schema migrations
│   │   ├── scheduler.ts       # Background task scheduler
│   │   ├── webhooks.ts        # Outbound webhook delivery
│   │   ├── websocket.ts       # Gateway WebSocket client
│   │   ├── use-server-events.ts # SSE for real-time UI updates
│   │   └── use-smart-poll.ts  # Visibility-aware polling hook
│   └── store/index.ts         # Zustand state (agents, tasks, chat, etc.)
└── .data/                     # Runtime data (SQLite DB, token logs)
```

## Features

### Navigation Panels

| Tab | Panel | Description |
|-----|-------|-------------|
| `overview` | Dashboard | System stats, uptime, active sessions, disk/memory |
| `tasks` | Task Board | Kanban board with 6 columns (inbox through done) |
| `agents` | Agent Squad | Agent cards with status, task stats, detail tabs |
| `activity` | Activity Feed | Real-time stream of all system events |
| `notifications` | Notifications | Per-agent alerts, mentions, assignments |
| `standup` | Standup Reports | Daily agent standup summaries |
| `spawn` | Agent Spawn | Launch new agent sessions |
| `sessions` | Session Inspector | Active gateway sessions with metadata |
| `logs` | Log Viewer | Browse agent log files with filtering |
| `cron` | Cron Manager | View/edit system crontab, trigger jobs |
| `memory` | Memory Browser | Browse/edit agent memory SQLite files |
| `tokens` | Token Dashboard | Cost tracking, model breakdown, trends |
| `users` | User Management | CRUD users with role assignment |
| `history` | Agent History | Historical agent activity and task stats |
| `audit` | Audit Trail | Immutable log of all admin actions |
| `webhooks` | Webhooks | Outbound webhook CRUD + delivery history |
| `alerts` | Alert Rules | Configurable rules engine with cooldowns |
| `gateways` | Gateway Manager | Multi-gateway connections + probing |
| `gateway-config` | Gateway Config | Edit openclaw.json directly |
| `settings` | Settings | UI-configurable app settings |

### Real-time

- **WebSocket**: Connects to OpenClaw gateway for live session/log/token events
- **SSE (Server-Sent Events)**: `/api/events` pushes DB changes to all connected clients
- **Smart Polling**: `useSmartPoll` hook pauses polling when browser tab is hidden, resumes on focus
- **Optimistic Chat**: Messages appear instantly, confirmed/retried asynchronously

### Background Scheduler

Three scheduled tasks managed by `src/lib/scheduler.ts`:

| Task | Interval | Default | Description |
|------|----------|---------|-------------|
| `auto_backup` | Daily (3 AM UTC) | Off | SQLite backup with retention pruning |
| `auto_cleanup` | Daily (4 AM UTC) | Off | Delete stale records per retention config |
| `agent_heartbeat` | 5 minutes | On | Mark unresponsive agents as offline |

Toggle via Settings panel or `PUT /api/settings` with keys `general.auto_backup`, `general.auto_cleanup`, `general.agent_heartbeat`.

## Authentication

### Methods

1. **Session cookie** (`mc-session`): Set by `POST /api/auth/login`. Expires in 7 days.
2. **API key** (`x-api-key` header): Matches `API_KEY` env var. Returns synthetic admin user.
3. **Legacy cookie** (`mission-control-auth`): Backward compat, matches `AUTH_SECRET` env var.

### Roles

| Role | Level | Access |
|------|-------|--------|
| `viewer` | 0 | Read-only access to all data |
| `operator` | 1 | Read + write (tasks, agents, chat) |
| `admin` | 2 | Full access (users, settings, dangerous ops) |

### Network Access

Middleware enforces a host allowlist in production.

- Dev/test: allows any host by default.
- Production: set `MC_ALLOWED_HOSTS` (comma-separated) or set `MC_ALLOW_ANY_HOST=1`.

Examples:
- Tailscale: `MC_ALLOWED_HOSTS=localhost,127.0.0.1,100.*,*.ts.net`
- Public: `MC_ALLOW_ANY_HOST=1`

## Database

SQLite via `better-sqlite3` with WAL mode. Stored at `.data/mission-control.db`.

### Tables

| Table | Migration | Purpose |
|-------|-----------|---------|
| `tasks` | 001 | Kanban task management |
| `agents` | 001 | Agent registry and status |
| `comments` | 001 | Task discussion threads |
| `activities` | 001 | Activity stream events |
| `notifications` | 001 | Alerts and mentions |
| `task_subscriptions` | 001 | Task follow/watch list |
| `standup_reports` | 001 | Archived standup summaries |
| `quality_reviews` | 002 | Aegis quality gate reviews |
| `messages` | 004 | Agent-to-agent chat |
| `conversations` | 004 | Chat conversation metadata |
| `users` | 005 | Auth users with hashed passwords |
| `user_sessions` | 005 | Session tokens |
| `workflow_templates` | 006 | Reusable pipeline templates |
| `audit_log` | 007 | Immutable admin action log |
| `webhooks` | 008 | Outbound webhook config |
| `webhook_deliveries` | 008 | Delivery attempt history |
| `pipeline_runs` | 009 | Pipeline execution records |
| `pipeline_steps` | 009 | Individual step results |
| `settings` | 010 | Key-value app settings |
| `alert_rules` | 011 | Configurable alert conditions |
| `gateways` | (lazy) | Multi-gateway connection registry |

The `gateways` table is created lazily on first API call, not via migration.

## API Reference

All endpoints require authentication (session cookie or API key) unless noted.

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/login` | None | Login: `{ username, password }` -> sets `mc-session` cookie |
| `POST` | `/api/auth/google` | None | Google Sign-In: `{ credential }` -> sets `mc-session` cookie (or 403 pending approval) |
| `POST` | `/api/auth/logout` | Session | Destroys current session |
| `GET` | `/api/auth/me` | Session | Returns current user info |
| `GET` | `/api/auth/access-requests` | Admin | List pending access requests |
| `POST` | `/api/auth/access-requests` | Admin | Approve/reject access requests |

### Core Resources

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/agents` | viewer | List all agents with task stats |
| `POST` | `/api/agents` | operator | Register/update agent |
| `GET` | `/api/tasks` | viewer | List tasks (filter: `?status=`, `?assigned_to=`, `?priority=`) |
| `POST` | `/api/tasks` | operator | Create task |
| `GET` | `/api/tasks/[id]` | viewer | Get task details |
| `PUT` | `/api/tasks/[id]` | operator | Update task |
| `DELETE` | `/api/tasks/[id]` | admin | Delete task |
| `GET` | `/api/tasks/[id]/comments` | viewer | List task comments |
| `POST` | `/api/tasks/[id]/comments` | operator | Add comment |
| `POST` | `/api/tasks/[id]/broadcast` | operator | Broadcast task to agents |

### Monitoring

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/status` | viewer | System status (uptime, memory, disk, sessions) |
| `GET` | `/api/activities` | viewer | Activity feed (filter: `?type=`, `?limit=`) |
| `GET` | `/api/notifications?recipient=X` | viewer | Notifications for recipient |
| `GET` | `/api/sessions` | viewer | Active gateway sessions |
| `GET` | `/api/tokens` | viewer | Token usage and cost data |
| `GET` | `/api/standup` | viewer | Standup report history |
| `POST` | `/api/standup` | operator | Generate today's standup |

### Configuration

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/settings` | admin | All settings (grouped) |
| `PUT` | `/api/settings` | admin | Update: `{ settings: { "key": "value" } }` |
| `GET` | `/api/gateway-config` | admin | Read openclaw.json |
| `PUT` | `/api/gateway-config` | admin | Update openclaw.json |
| `GET` | `/api/cron?action=list` | admin | List crontab entries |
| `GET` | `/api/cron?action=logs` | admin | Cron execution logs |
| `POST` | `/api/cron` | admin | Cron actions: toggle, add, remove, trigger |

### Operational

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/scheduler` | admin | Scheduler task status |
| `POST` | `/api/scheduler` | admin | Trigger task: `{ task_id: "agent_heartbeat" }` |
| `GET` | `/api/audit` | admin | Audit log (paginated) |
| `GET` | `/api/logs` | viewer | Browse agent log files |
| `GET` | `/api/memory?action=tree` | viewer | Memory file tree |
| `GET` | `/api/memory?action=content&path=X` | viewer | Read memory file |
| `GET` | `/api/memory?action=search&query=X` | viewer | Search memory |
| `GET` | `/api/search?q=X` | viewer | Global search across entities |
| `GET` | `/api/export?type=X` | admin | CSV export (types: tasks, audit, activities, pipelines) |

### Integrations

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/webhooks` | admin | List webhooks |
| `POST` | `/api/webhooks` | admin | Create webhook |
| `PUT` | `/api/webhooks` | admin | Update webhook |
| `DELETE` | `/api/webhooks?id=X` | admin | Delete webhook |
| `POST` | `/api/webhooks/test` | admin | Send test delivery |
| `GET` | `/api/webhooks/deliveries` | admin | Delivery history |
| `GET` | `/api/alerts` | admin | List alert rules |
| `POST` | `/api/alerts` | admin | Create rule or evaluate: `{ action: "evaluate" }` |
| `PUT` | `/api/alerts` | admin | Update rule |
| `DELETE` | `/api/alerts` | admin | Delete rule: `{ id: N }` |
| `GET` | `/api/gateways` | admin | List gateways |
| `POST` | `/api/gateways` | admin | Add gateway |
| `PUT` | `/api/gateways` | admin | Update gateway |
| `DELETE` | `/api/gateways` | admin | Delete gateway: `{ id: N }` |

### Real-time

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/events` | Session | SSE stream of DB changes |

### Chat

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/chat/conversations` | viewer | List conversations |
| `POST` | `/api/chat/conversations` | operator | Create conversation |
| `GET` | `/api/chat/messages?conversation_id=X` | viewer | Messages in conversation |
| `POST` | `/api/chat/messages` | operator | Send message |

### Agent Lifecycle

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `POST` | `/api/spawn` | operator | Spawn new agent session |
| `POST` | `/api/agents/[id]/heartbeat` | operator | Agent heartbeat + task check-in |
| `POST` | `/api/agents/[id]/wake` | operator | Wake up sleeping agent |
| `POST` | `/api/quality-review` | operator | Submit quality review for task |

### Pipelines & Workflows

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/pipelines` | viewer | List pipeline runs |
| `POST` | `/api/pipelines/run` | operator | Start pipeline run |
| `GET` | `/api/workflows` | viewer | List workflow templates |
| `POST` | `/api/workflows` | admin | Create workflow template |

## Environment Variables

See `.env.example` for the complete list. Key variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTH_USER` | No | `admin` | Initial admin username |
| `AUTH_PASS` | No | - | Initial admin password (set this) |
| `API_KEY` | No | - | API key for `x-api-key` auth |
| `OPENCLAW_HOME` | Yes* | - | Path to `.openclaw` dir (needed for memory, logs, gateway config) |
| `OPENCLAW_GATEWAY_HOST` | No | `127.0.0.1` | Gateway host for server-side calls/seeded gateway |
| `OPENCLAW_GATEWAY_PORT` | No | `18789` | Gateway WebSocket port |
| `OPENCLAW_GATEWAY_TOKEN` | No | - | Gateway token for server-side calls (optional) |
| `NEXT_PUBLIC_GATEWAY_HOST` | No | - | Gateway host for the browser WebSocket (defaults to page hostname) |
| `NEXT_PUBLIC_GATEWAY_PORT` | No | `18789` | Gateway port for browser WebSocket |
| `NEXT_PUBLIC_GATEWAY_PROTOCOL` | No | - | `ws` or `wss` (defaults based on page protocol) |
| `NEXT_PUBLIC_GATEWAY_URL` | No | - | Full override for browser WebSocket URL |
| `MC_TENANT_HOME_ROOT` | No | `/home` | Base path used by Super Admin provisioning (linux user home root) |
| `MC_TENANT_WORKSPACE_DIRNAME` | No | `workspace` | Workspace dir name under each tenant user home |

*Memory browser, log viewer, and gateway config won't work without `OPENCLAW_HOME`.

## Deployment

### Production (systemd)

```bash
# Build
cd ~/repos/mission-control
pnpm install --frozen-lockfile
pnpm build

# Run (with required env vars)
OPENCLAW_HOME=/path/to/.openclaw \
  npx next start -p 3005
```

### Manual deploy from dev machine

```bash
# Sync to server (preserve .data dir!)
rsync -az --delete \
  --exclude='.next' \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.data' \
  ./  server:~/repos/mission-control/

# On server
cd ~/repos/mission-control
pnpm install --frozen-lockfile
rm -rf .next && pnpm build
fuser -k 3005/tcp  # kill old process
OPENCLAW_HOME=$HOME/.openclaw nohup npx next start -p 3005 > /tmp/mc.log 2>&1 &
```

**Important**: Always `--exclude='.data'` in rsync to avoid wiping the production database.

## Development

```bash
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm typecheck    # TypeScript check
pnpm lint         # ESLint
pnpm test         # Vitest
pnpm test:e2e     # Playwright
pnpm quality:gate # All checks
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.1 (App Router) |
| Runtime | React 19, TypeScript 5.7 |
| Database | SQLite (better-sqlite3, WAL mode) |
| State | Zustand 5 |
| Styling | Tailwind CSS 3.4 |
| Charts | Recharts 3 |
| Real-time | WebSocket + SSE |
| Auth | scrypt password hashing, session tokens |
| Testing | Vitest + Playwright |

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
