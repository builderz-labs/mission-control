<div align="center">

# Mission Control

**The open-source dashboard for AI agent orchestration.**

Manage agent fleets, track tasks, monitor costs, and orchestrate workflows — all from a single pane of glass.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)

</div>

---

> **Alpha Software** — Mission Control is under active development. APIs, database schemas, and configuration formats may change between releases. Review the [known limitations](#known-limitations) and [security considerations](#security-considerations) before deploying to production.

## Why Mission Control?

Running AI agents at scale means juggling sessions, tasks, costs, and reliability across multiple models and channels. Mission Control gives you:

- **20+ panels** — Tasks, agents, logs, tokens, memory, cron, alerts, webhooks, pipelines, and more
- **Real-time everything** — WebSocket + SSE push updates, smart polling that pauses when you're away
- **Zero external dependencies** — SQLite database, single `pnpm start` to run, no Redis/Postgres/Docker required
- **Role-based access** — Viewer, operator, and admin roles with session + API key auth
- **Quality gates** — Built-in review system that blocks task completion without sign-off
- **Multi-gateway** — Connect to multiple OpenClaw gateways simultaneously

## Quick Start

```bash
git clone https://github.com/builderz-labs/mission-control.git
cd mission-control
pnpm install
cp .env.example .env    # edit with your values
pnpm dev                # http://localhost:3000
```

Initial login is seeded from `AUTH_USER` / `AUTH_PASS` on first run.

## Project Status

### What Works

- Agent management with full lifecycle (register, heartbeat, wake, retire)
- Kanban task board with drag-and-drop, priorities, assignments, and comments
- Real-time monitoring via WebSocket + SSE with smart polling
- Token usage and cost tracking with per-model breakdowns
- Multi-gateway connection management
- Role-based access control (viewer, operator, admin)
- Background scheduler for automated tasks
- Outbound webhooks with delivery history and retry
- Quality review gates for task sign-off
- Pipeline orchestration with workflow templates

### Known Limitations

- **Zero test coverage** — Vitest and Playwright are configured but no tests have been written yet
- **TypeScript strict mode disabled** — `tsconfig.json` has `strict: false` despite the contributing guide recommending strict mode
- **No rate limiting** on login or API endpoints
- **No CSRF token validation** — relies on `SameSite=Strict` cookies only
- **Legacy cookie auth** path still present alongside the modern session-based auth system
- **CSP includes `unsafe-eval` and `unsafe-inline`** — weakens XSS protection
- **Some GET API endpoints missing explicit auth checks** — tracked in [issues](https://github.com/builderz-labs/mission-control/issues)

### Security Considerations

- **Change all default credentials** (`AUTH_USER`, `AUTH_PASS`, `API_KEY`) before deploying
- **Deploy behind a reverse proxy with TLS** (e.g., Caddy, nginx) for any network-accessible deployment
- **Review [SECURITY.md](SECURITY.md)** for the vulnerability reporting process
- **Do not expose the dashboard to the public internet** without reviewing the open issues labeled `security`

## Features

### Agent Management
Monitor agent status, spawn new sessions, view heartbeats, and manage the full agent lifecycle from registration to retirement.

### Task Board
Kanban board with six columns (inbox → backlog → todo → in-progress → review → done), drag-and-drop, priority levels, assignments, and threaded comments.

### Real-time Monitoring
Live activity feed, session inspector, and log viewer with filtering. WebSocket connection to OpenClaw gateway for instant event delivery.

### Cost Tracking
Token usage dashboard with per-model breakdowns, trend charts, and cost analysis powered by Recharts.

### Background Automation
Scheduled tasks for database backups, stale record cleanup, and agent heartbeat monitoring. Configurable via UI or API.

### Integrations
Outbound webhooks with delivery history, configurable alert rules with cooldowns, and multi-gateway connection management. Optional 1Password CLI integration for secret management.

## Architecture

```
mission-control/
├── middleware.ts              # Auth gate + network access control
├── src/
│   ├── app/
│   │   ├── page.tsx           # SPA shell — routes all panels
│   │   ├── login/page.tsx     # Login page
│   │   └── api/               # 25+ REST API routes
│   ├── components/
│   │   ├── layout/            # NavRail, HeaderBar, LiveFeed
│   │   ├── dashboard/         # Overview dashboard
│   │   ├── panels/            # 23 feature panels
│   │   └── chat/              # Agent chat UI
│   ├── lib/
│   │   ├── auth.ts            # Session + API key auth, RBAC
│   │   ├── db.ts              # SQLite (better-sqlite3, WAL mode)
│   │   ├── migrations.ts      # 11 schema migrations
│   │   ├── scheduler.ts       # Background task scheduler
│   │   ├── webhooks.ts        # Outbound webhook delivery
│   │   └── websocket.ts       # Gateway WebSocket client
│   └── store/index.ts         # Zustand state management
└── .data/                     # Runtime data (SQLite DB, token logs)
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 3.4 |
| Language | TypeScript 5.7 |
| Database | SQLite via better-sqlite3 (WAL mode) |
| State | Zustand 5 |
| Charts | Recharts 3 |
| Real-time | WebSocket + Server-Sent Events |
| Auth | scrypt hashing, session tokens, RBAC |
| Testing | Vitest + Playwright |

## Authentication

Three auth methods, three roles:

| Method | Details |
|--------|----------|
| Session cookie | `POST /api/auth/login` sets `mc-session` (7-day expiry) |
| API key | `x-api-key` header matches `API_KEY` env var |
| Google Sign-In | OAuth with admin approval workflow |

| Role | Access |
|------|--------|
| `viewer` | Read-only |
| `operator` | Read + write (tasks, agents, chat) |
| `admin` | Full access (users, settings, system ops) |

## API Reference

All endpoints require authentication unless noted. Full reference below.

<details>
<summary><strong>Auth</strong></summary>

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Login with username/password |
| `POST` | `/api/auth/google` | Google Sign-In |
| `POST` | `/api/auth/logout` | Destroy session |
| `GET` | `/api/auth/me` | Current user info |
| `GET` | `/api/auth/access-requests` | List pending access requests (admin) |
| `POST` | `/api/auth/access-requests` | Approve/reject requests (admin) |

</details>

<details>
<summary><strong>Core Resources</strong></summary>

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/agents` | viewer | List agents with task stats |
| `POST` | `/api/agents` | operator | Register/update agent |
| `GET` | `/api/tasks` | viewer | List tasks (filter: `?status=`, `?assigned_to=`, `?priority=`) |
| `POST` | `/api/tasks` | operator | Create task |
| `GET` | `/api/tasks/[id]` | viewer | Task details |
| `PUT` | `/api/tasks/[id]` | operator | Update task |
| `DELETE` | `/api/tasks/[id]` | admin | Delete task |
| `GET` | `/api/tasks/[id]/comments` | viewer | Task comments |
| `POST` | `/api/tasks/[id]/comments` | operator | Add comment |
| `POST` | `/api/tasks/[id]/broadcast` | operator | Broadcast task to agents |

</details>

<details>
<summary><strong>Monitoring</strong></summary>

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/status` | viewer | System status (uptime, memory, disk) |
| `GET` | `/api/activities` | viewer | Activity feed |
| `GET` | `/api/notifications` | viewer | Notifications for recipient |
| `GET` | `/api/sessions` | viewer | Active gateway sessions |
| `GET` | `/api/tokens` | viewer | Token usage and cost data |
| `GET` | `/api/standup` | viewer | Standup report history |
| `POST` | `/api/standup` | operator | Generate standup |

</details>

<details>
<summary><strong>Configuration</strong></summary>

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET/PUT` | `/api/settings` | admin | App settings |
| `GET/PUT` | `/api/gateway-config` | admin | OpenClaw gateway config |
| `GET/POST` | `/api/cron` | admin | Cron management |

</details>

<details>
<summary><strong>Operations</strong></summary>

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET/POST` | `/api/scheduler` | admin | Background task scheduler |
| `GET` | `/api/audit` | admin | Audit log |
| `GET` | `/api/logs` | viewer | Agent log browser |
| `GET` | `/api/memory` | viewer | Memory file browser/search |
| `GET` | `/api/search` | viewer | Global search |
| `GET` | `/api/export` | admin | CSV export |

</details>

<details>
<summary><strong>Integrations</strong></summary>

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET/POST/PUT/DELETE` | `/api/webhooks` | admin | Webhook CRUD |
| `POST` | `/api/webhooks/test` | admin | Test delivery |
| `GET` | `/api/webhooks/deliveries` | admin | Delivery history |
| `GET/POST/PUT/DELETE` | `/api/alerts` | admin | Alert rules |
| `GET/POST/PUT/DELETE` | `/api/gateways` | admin | Gateway connections |
| `GET/PUT/DELETE/POST` | `/api/integrations` | admin | Integration management |

</details>

<details>
<summary><strong>Chat & Real-time</strong></summary>

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/events` | SSE stream of DB changes |
| `GET/POST` | `/api/chat/conversations` | Conversation CRUD |
| `GET/POST` | `/api/chat/messages` | Message CRUD |

</details>

<details>
<summary><strong>Agent Lifecycle</strong></summary>

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `POST` | `/api/spawn` | operator | Spawn agent session |
| `POST` | `/api/agents/[id]/heartbeat` | operator | Agent heartbeat |
| `POST` | `/api/agents/[id]/wake` | operator | Wake sleeping agent |
| `POST` | `/api/quality-review` | operator | Submit quality review |

</details>

<details>
<summary><strong>Pipelines</strong></summary>

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/pipelines` | viewer | List pipeline runs |
| `POST` | `/api/pipelines/run` | operator | Start pipeline |
| `GET/POST` | `/api/workflows` | viewer/admin | Workflow templates |

</details>

## Environment Variables

See [`.env.example`](.env.example) for the complete list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTH_USER` | No | Initial admin username (default: `admin`) |
| `AUTH_PASS` | No | Initial admin password |
| `API_KEY` | No | API key for headless access |
| `OPENCLAW_HOME` | Yes* | Path to `.openclaw` directory |
| `OPENCLAW_GATEWAY_HOST` | No | Gateway host (default: `127.0.0.1`) |
| `OPENCLAW_GATEWAY_PORT` | No | Gateway WebSocket port (default: `18789`) |
| `MC_ALLOWED_HOSTS` | No | Host allowlist for production |

*Memory browser, log viewer, and gateway config require `OPENCLAW_HOME`.

## Deployment

```bash
# Build
pnpm install --frozen-lockfile
pnpm build

# Run
OPENCLAW_HOME=/path/to/.openclaw pnpm start
```

Network access is restricted by default in production. Set `MC_ALLOWED_HOSTS` (comma-separated) or `MC_ALLOW_ANY_HOST=1` to control access.

## Development

```bash
pnpm dev              # Dev server
pnpm build            # Production build
pnpm typecheck        # TypeScript check
pnpm lint             # ESLint
pnpm test             # Vitest unit tests
pnpm test:e2e         # Playwright E2E
pnpm quality:gate     # All checks
```

## Roadmap

See [open issues](https://github.com/builderz-labs/mission-control/issues) for the full list. Key priorities:

- [ ] Fix unauthenticated GET endpoints ([#4](https://github.com/builderz-labs/mission-control/issues/4))
- [ ] Fix API key timing attack ([#5](https://github.com/builderz-labs/mission-control/issues/5))
- [ ] Fix stored XSS in memory browser ([#6](https://github.com/builderz-labs/mission-control/issues/6))
- [ ] Remove legacy cookie auth ([#7](https://github.com/builderz-labs/mission-control/issues/7))
- [ ] Add rate limiting on login ([#8](https://github.com/builderz-labs/mission-control/issues/8))
- [ ] Enable TypeScript strict mode ([#11](https://github.com/builderz-labs/mission-control/issues/11))
- [ ] Add unit and E2E test coverage ([#12](https://github.com/builderz-labs/mission-control/issues/12))
- [ ] Tighten CSP headers ([#15](https://github.com/builderz-labs/mission-control/issues/15))
- [ ] Add CODE_OF_CONDUCT.md ([#16](https://github.com/builderz-labs/mission-control/issues/16))
- [ ] Add issue templates ([#17](https://github.com/builderz-labs/mission-control/issues/17))
- [ ] Add CSRF token validation ([#20](https://github.com/builderz-labs/mission-control/issues/20))

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 [Builderz Labs](https://github.com/builderz-labs)
