# Codebase Structure

**Analysis Date:** 2026-03-15

## Directory Layout

```
Mission Control/
├── .data/              # SQLite database + runtime state (gitignored)
├── .github/            # GitHub Actions workflows
├── .planning/          # GSD planning documents (codebase map, project)
├── docs/               # Documentation, plans, release notes
├── e2e-openclaw/       # OpenClaw-specific E2E test fixtures
├── ops/                # Operational scripts (Docker, deployment)
├── public/             # Static assets (favicon, images)
├── scripts/            # Install, deploy, diagnostics, E2E helpers
├── skills/             # Claude Code skills (installer, manager)
├── src/                # Application source code
│   ├── app/            # Next.js App Router (pages + API routes)
│   ├── components/     # UI components (panels, layout, shared)
│   ├── i18n/           # Internationalization config
│   ├── lib/            # Core logic, database, utilities (100+ modules)
│   ├── plugins/        # Plugin examples and definitions
│   ├── store/          # Zustand state management
│   ├── test/           # Test setup files
│   └── types/          # TypeScript type definitions
├── tests/              # E2E test specs (Playwright)
├── wiki/               # GitHub wiki content
├── CLAUDE.md           # Claude Code conventions
├── docker-compose.yml  # Docker configuration
├── next.config.js      # Next.js configuration
├── package.json        # Project manifest
├── playwright.config.ts # E2E test configuration
├── tailwind.config.js  # Tailwind CSS configuration
├── tsconfig.json       # TypeScript configuration
└── vitest.config.ts    # Unit test configuration
```

## Directory Purposes

**src/app/:**
- Purpose: Next.js App Router pages and API routes
- Contains: `page.tsx`, `layout.tsx`, `route.ts` files
- Key files: `layout.tsx` (root layout with theme), `page.tsx` (dashboard entry)
- Subdirectories: `api/` (158 route files), `login/`, `setup/`

**src/app/api/:**
- Purpose: RESTful API endpoints (158 route files across 177 directories)
- Route groups: `agents/`, `tasks/`, `sessions/`, `workflows/`, `webhooks/`, `settings/`, `auth/`, `cron/`, `chat/`, `backup/`, `skills/`, `super/` (multi-tenant admin), `local/` (terminal, flight-deck), `projects/`, `alerts/`, `notifications/`, `memory/`, `command/`, `integrations/`, `channels/`, `nodes/`, `logs/`, `standup/`, `cleanup/`, `releases/`, `simulation/`, `security-scan/`, `exec-approvals/`, `hermes/`, `github/`

**src/components/:**
- Purpose: UI components organized by function
- Subdirectories:
  - `panels/` — Dashboard panels (agent-detail-tabs, office-panel, task-board, cron-management, token-dashboard, etc.)
  - `layout/` — Shell layout (nav-rail, sidebar)
  - `ui/` — Shared primitives (button, loader, online-status, theme-background)
  - `dashboard/` — Dashboard-specific components (command-console)
  - `onboarding/` — Setup wizard, security-scan-card

**src/lib/:**
- Purpose: Core business logic, database, utilities (100+ modules)
- Key files:
  - `db.ts` — Database connection, WAL mode, process cleanup
  - `auth.ts` — Authentication, `getUserFromRequest()`, `requireRole()`
  - `migrations.ts` — 57 schema migrations
  - `schema.sql` — Base schema (135 lines)
  - `config.ts` — Centralized configuration from env vars
  - `validation.ts` — Zod schemas for API input validation
  - `event-bus.ts` — Pub/sub event system
  - `rate-limit.ts` — In-memory rate limiting
  - `logger.ts` — pino structured logger
  - `webhooks.ts` — Outgoing webhook delivery with HMAC signatures
  - `scheduler.ts` — Cron job scheduling
  - `skill-registry.ts` — External skill search/install with security scanning
  - `consensus-engine.ts` — Multi-node consensus
  - `cluster-manager.ts` — Cluster management
  - `virtual-office-simulator.ts` — Agent simulation
- Subdirectories:
  - `adapters/` — Agent framework adapters (AutoGen, CrewAI, LangGraph, Claude SDK, OpenClaw, Generic)
  - `llm/` — LLM router, inference adapter interface, output repair
  - `services/` — Domain services (mission-debrief, sovereignty-policy)
  - `__tests__/` — 69 unit test files

**src/store/:**
- Purpose: Zustand state management (1,146 lines)
- Contains: `index.ts` — Single store with `subscribeWithSelector` middleware
- State: Sessions, agents, tasks, log entries, cron jobs, memory files, token usage, UI preferences

**src/types/:**
- Purpose: Shared TypeScript type definitions
- Contains: `index.ts` — `Session`, `Agent`, `ChatMessage`, `ClaudeSessionRow`, etc.

**tests/:**
- Purpose: E2E test specs (84 Playwright spec files)
- Contains: `*.spec.ts` files, `helpers.ts` (test factories + cleanup)
- Subdirectories: `fixtures/openclaw/` (mock CLI fixtures)
- Key files: `helpers.ts` — `createTestTask()`, `createTestAgent()`, `API_KEY_HEADER`

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx` — Root layout (theme, fonts, CSP nonce script)
- `src/app/page.tsx` — Dashboard page
- `src/proxy.ts` — Next.js middleware (host validation, security headers)
- `.next/standalone/server.js` — Production standalone server
- `scripts/start-standalone.sh` — LaunchAgent startup script

**Configuration:**
- `tsconfig.json` — TypeScript (strict, `@/*` path alias)
- `next.config.js` — Standalone output, transpilePackages, security headers
- `tailwind.config.js` — Custom theme, dark mode, CSS variable colors
- `vitest.config.ts` — jsdom, 60% coverage threshold
- `playwright.config.ts` — Chromium, 1 worker, 60s timeout
- `.env` / `.env.example` / `.env.test` — Environment variables

**Core Logic:**
- `src/lib/db.ts` — Database singleton, WAL mode, cleanup hooks
- `src/lib/auth.ts` — Auth flow (session → API key → agent keys)
- `src/lib/migrations.ts` — 57 migrations (001-057)
- `src/lib/llm/router.ts` — Tiered LLM routing with budget enforcement
- `src/lib/event-bus.ts` — Real-time event dispatch

**Testing:**
- `src/lib/__tests__/` — 69 unit test files
- `tests/` — 84 E2E spec files
- `tests/helpers.ts` — Shared E2E factories and cleanup
- `src/test/setup.ts` — Vitest setup (jest-dom matchers)

**Documentation:**
- `CLAUDE.md` — Claude Code conventions and pitfalls
- `README.md` — Setup, run, Docker guide
- `docs/` — Deployment, CLI integration, security hardening
- `docs/plans/` — Feature and roadmap plans
- `docs/releases/` — Release notes (2.0.0.md)
- `tests/README.md` — E2E test guide with spec inventory

## Naming Conventions

**Files:**
- `kebab-case.ts` — All source files, components, lib modules
- `*.test.ts` — Unit tests (in `src/lib/__tests__/`)
- `*.spec.ts` — E2E tests (in `tests/`)
- `UPPER_CASE.md` — Important project files (CLAUDE.md, README.md)

**Directories:**
- `kebab-case` — All directories
- Plural for collections: `panels/`, `adapters/`, `services/`
- `__tests__/` — Unit test directory convention

**Special Patterns:**
- `route.ts` — Next.js API route handler
- `page.tsx` / `layout.tsx` — Next.js page/layout convention
- `index.ts` — Barrel exports for directories
- `[param]` — Dynamic route segments (e.g., `[id]/route.ts`)

## Where to Add New Code

**New Feature (e.g., workflow engine, debate rooms):**
- Core logic: `src/lib/{feature-name}.ts`
- API routes: `src/app/api/{feature-name}/route.ts`
- UI panel: `src/components/panels/{feature-name}-panel.tsx`
- Types: `src/types/index.ts` (or new `src/types/{feature}.ts`)
- Migration: Add to `src/lib/migrations.ts` (next number in sequence)
- Unit tests: `src/lib/__tests__/{feature-name}.test.ts`
- E2E tests: `tests/{feature-name}.spec.ts`

**New API Route:**
- Route: `src/app/api/{resource}/route.ts`
- Dynamic: `src/app/api/{resource}/[id]/route.ts`
- Validation: Add Zod schema in route file or `src/lib/validation.ts`

**New UI Panel:**
- Component: `src/components/panels/{panel-name}-panel.tsx` (with `'use client'`)
- Register in nav-rail: `src/components/layout/nav-rail.tsx`

**New Agent Adapter:**
- Implementation: `src/lib/adapters/{framework-name}.ts`
- Register: `src/lib/adapters/index.ts`

**Utilities:**
- Shared helpers: `src/lib/{utility-name}.ts`
- Custom hooks: `src/lib/use-{hook-name}.ts`
- Type definitions: `src/types/index.ts`

## Special Directories

**.data/:**
- Purpose: SQLite database and runtime state
- Contains: `mission-control.db`, `.auto-generated` (credentials)
- Committed: No (gitignored)

**.next/:**
- Purpose: Next.js build output
- Contains: `standalone/` (production server), `static/` (client bundles)
- Committed: No (gitignored)

**.planning/:**
- Purpose: GSD project planning documents
- Contains: `codebase/` (this analysis), future `PROJECT.md`, `config.json`
- Committed: Yes

---

*Structure analysis: 2026-03-15*
*Update when directory structure changes*
