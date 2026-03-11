# Mission Control — Landing Page Handoff

> Last updated: 2026-03-07 | Version: 1.3.0 | Branch: `fix/refactor` (bb5029e)

This document contains all copy, stats, features, and structure needed to build or update the Mission Control landing page. Everything below reflects the current state of the shipped product.

---

## Hero Section

**Headline:**
The Open-Source Dashboard for AI Agent Orchestration

**Subheadline:**
Manage agent fleets, track tasks, monitor costs, and orchestrate workflows — all from a single pane of glass. Zero external dependencies. One `pnpm start` to run.

**CTA:** `Get Started` -> GitHub repo | `Live Demo` -> demo instance (if available)

**Badges:**
- MIT License
- Next.js 16
- React 19
- TypeScript 5.7
- SQLite (WAL mode)
- 165 unit tests (Vitest)
- 295 E2E tests (Playwright)

**Hero image:** `docs/mission-control-overview.png` (latest overview dashboard screenshot)

---

## Key Stats (above the fold)

| Stat | Value |
|------|-------|
| Panels | 31 feature panels |
| API routes | 98 REST endpoints |
| Schema migrations | 36 |
| Test coverage | 165 unit + 295 E2E |
| Total commits | 239+ |
| External dependencies required | 0 (SQLite only, no Redis/Postgres/Docker) |
| Auth methods | 3 (session, API key, Google OAuth) |
| Framework adapters | 6 (OpenClaw, CrewAI, LangGraph, AutoGen, Claude SDK, Generic) |

---

## Feature Grid

### 1. Task Board (Kanban)
Six-column kanban (Inbox > Assigned > In Progress > Review > Quality Review > Done) with drag-and-drop, priority levels, assignments, threaded comments, and inline sub-agent spawning. Multi-project support with per-project ticket prefixes (e.g. `PA-001`).

### 2. Agent Management
Full lifecycle — register, heartbeat, wake, retire. Redesigned agent detail modal with compact overview, inline model selector, editable sub-agent configuration, and SOUL personality system. Local agent discovery from `~/.agents/`, `~/.codex/agents/`, `~/.claude/agents/`.

### 3. Real-Time Monitoring
Live activity feed, session inspector, and log viewer with filtering. WebSocket + SSE push updates with smart polling that pauses when you're away. Gateway connection state with live dot indicators.

### 4. Cost Tracking
Token usage dashboard with per-model breakdowns, trend charts, and cost analysis. Per-agent cost panels with session-level granularity.

### 5. Quality Gates (Aegis)
Built-in review system that blocks task completion without sign-off. Automated Aegis quality review — scheduler polls review tasks and approves/rejects based on configurable criteria.

### 6. Recurring Tasks
Natural language scheduling — "every morning at 9am", "every 2 hours". Zero-dependency schedule parser converts to cron. Template-clone pattern spawns dated child tasks (e.g. "Daily Report — Mar 07").

### 7. Task Dispatch
Scheduler polls assigned tasks and runs agents via CLI. Dispatched tasks link to agent sessions for full traceability.

### 8. Skills Hub
Browse, install, and manage agent skills from local directories and external registries (ClawdHub, skills.sh). Built-in security scanner checks for prompt injection, credential leaks, data exfiltration, and obfuscated content. Bidirectional disk-DB sync with SHA-256 change detection.

### 9. Claude Code Integration
- **Session tracking** — auto-discovers sessions from `~/.claude/projects/`, extracts tokens, model info, costs
- **Task bridge** — read-only integration surfaces Claude Code team tasks and configs
- **Direct CLI** — connect Claude Code, Codex, or any CLI directly without a gateway

### 10. Memory Knowledge Graph
Visual knowledge graph for agent memory in gateway mode. Interactive node-edge visualization of agent memory relationships.

### 11. Agent Messaging (Comms)
Session-threaded inter-agent communication via comms API (`a2a:*`, `coord:*`, `session:*`). Coordinator inbox support with runtime tool-call visibility.

### 12. Multi-Gateway
Connect to multiple agent gateways simultaneously. OS-level gateway discovery (systemd, Tailscale Serve). Auto-connect with health probes.

### 13. Framework Adapters
Built-in adapter layer for multi-agent registration: OpenClaw, CrewAI, LangGraph, AutoGen, Claude SDK, and generic fallback. Each normalizes registration, heartbeats, and task reporting.

### 14. Background Automation
Scheduled tasks for DB backups, stale record cleanup, agent heartbeat monitoring, recurring task spawning, and automated quality reviews.

### 15. Webhooks & Alerts
Outbound webhooks with delivery history, retry with exponential backoff, circuit breaker, and HMAC-SHA256 signature verification. Configurable alert rules with cooldowns.

### 16. GitHub Sync
Bidirectional GitHub Issues sync with label and assignee mapping. Full parity sync implementation.

### 17. Security
- Ed25519 device identity for gateway handshake
- scrypt password hashing
- RBAC (viewer, operator, admin)
- CSRF origin checks
- CSP headers
- Rate limiting with trusted proxy support
- Per-agent rate limiting with `x-agent-name` identity-based quotas
- Skill security scanner

### 18. Self-Update
GitHub release check with banner notification. One-click admin update (git pull, pnpm install, pnpm build). Dirty working trees rejected. All updates audit-logged.

### 19. Audit Trail
Complete action type coverage with grouped filters. Full audit history for compliance and debugging.

### 20. Pipelines & Workflows
Pipeline orchestration with workflow templates. Start, monitor, and manage multi-step agent workflows.

---

## "How It Works" Section

```
1. Clone & Start       git clone ... && pnpm install && pnpm dev
2. Agents Register     Via gateway, CLI, or self-registration endpoint
3. Tasks Flow          Kanban board with automatic dispatch and quality gates
4. Monitor & Scale     Real-time dashboards, cost tracking, recurring automation
```

---

## Tech Stack Section

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
| Validation | Zod 4 |
| Testing | Vitest + Playwright |

---

## Auth & Access Section

**Three auth methods:**
1. Session cookie — username/password login (7-day expiry)
2. API key — `x-api-key` header for headless/agent access
3. Google Sign-In — OAuth with admin approval workflow

**Three roles:**
| Role | Access |
|------|--------|
| Viewer | Read-only dashboard access |
| Operator | Read + write (tasks, agents, chat, spawn) |
| Admin | Full access (users, settings, system ops, webhooks) |

---

## Architecture Diagram (simplified)

```
mission-control/
  src/
    app/api/          98 REST API routes
    components/
      panels/         31 feature panels
      dashboard/      Overview dashboard
      chat/           Agent chat workspace
      layout/         NavRail, HeaderBar, LiveFeed
    lib/
      auth.ts         Session + API key + Google OAuth
      db.ts           SQLite (WAL mode, 36 migrations)
      scheduler.ts    Background automation
      websocket.ts    Gateway WebSocket client
      adapters/       6 framework adapters
  .data/              Runtime SQLite DB + token logs
```

---

## Quick Start Section

```bash
git clone https://github.com/builderz-labs/mission-control.git
cd mission-control
pnpm install
cp .env.example .env    # edit with your values
pnpm dev                # http://localhost:3000
```

Initial login seeded from `AUTH_USER` / `AUTH_PASS` on first run.

---

## Social Proof / Traction

- 239+ commits of active development
- Open-source MIT license
- Used in production for multi-agent orchestration
- Supports 6 agent frameworks out of the box
- Zero-config SQLite — no Docker, Redis, or Postgres required

---

## Roadmap / Coming Soon

- Agent-agnostic gateway support (OpenClaw, ZeroClaw, OpenFang, NeoBot, IronClaw, etc.)
- **Flight Deck** — native desktop companion app (Tauri v2) with real PTY terminal grid and system tray HUD (private beta)
- First-class per-agent cost breakdowns panel
- OAuth approval UI improvements
- API token rotation UI

---

## Recent Changelog (latest 20 notable changes)

1. **Memory knowledge graph** — interactive visualization for agent memory in gateway mode
2. **Agent detail modal redesign** — minimal header, compact overview, inline model selector
3. **Spawn/task unification** — spawn moved inline to task board, sub-agent config to agent detail
4. **Agent comms hardening** — session-threaded messaging with runtime tool visibility
5. **Audit trail** — complete action type coverage with grouped filters
6. **OS-level gateway discovery** — detect gateways via systemd and Tailscale Serve
7. **GitHub sync** — full parity sync with loading state fixes
8. **Automated Aegis quality review** — scheduler-driven approve/reject
9. **Task dispatch** — scheduler polls and runs agents via CLI with session linking
10. **Natural language recurring tasks** — zero-dep schedule parser + template spawning
11. **Claude Code task bridge** — read-only team task and config integration
12. **Agent card redesign** — gateway badge tooltips, ws:// localhost support
13. **Skills Hub** — registry integration, bidirectional sync, security scanner
14. **Per-agent rate limiting** — identity-based quotas via `x-agent-name`
15. **Agent self-registration** — autonomous onboarding endpoint
16. **Framework adapters** — OpenClaw, CrewAI, LangGraph, AutoGen, Claude SDK, generic
17. **Self-update mechanism** — one-click update with audit logging
18. **Local agent discovery** — auto-detect from ~/.agents, ~/.codex, ~/.claude
19. **Chat workspace** — embedded chat with local session continuation
20. **Ed25519 device identity** — secure gateway challenge-response handshake

---

## Footer

MIT License | 2026 Builderz Labs
GitHub: github.com/builderz-labs/mission-control
