# Testing Patterns

**Analysis Date:** 2026-03-15

## Test Framework

**Unit Tests:**
- Vitest 2.1.5
- Config: `vitest.config.ts` (jsdom environment, globals enabled)
- Setup: `src/test/setup.ts` (imports `@testing-library/jest-dom`)

**E2E Tests:**
- Playwright 1.51.0
- Config: `playwright.config.ts` (Chromium only, 1 worker, sequential)
- Timeout: 60s per test, 10s for expect
- Reporter: Dot (CI) / List (dev) + JSON to `test-results/e2e-results.json`

**Run Commands:**
```bash
pnpm test                    # Unit tests (vitest run)
pnpm test -- --watch         # Watch mode (vitest)
pnpm test:e2e:ci             # E2E with dot reporter (use from Claude Code)
pnpm test:e2e                # E2E with list reporter (interactive use)
pnpm test:all                # lint + typecheck + test + build + e2e
pnpm typecheck               # tsc --noEmit
pnpm lint                    # eslint
```

**Important:** Always use `pnpm test:e2e:ci` from Claude Code — list reporter output overflows context. Read `test-results/e2e-results.json` for failure details.

## Test File Organization

**Location:**
- Unit tests: `src/lib/__tests__/*.test.ts` (69 files)
- E2E tests: `tests/*.spec.ts` (84 files)

**Naming:**
- Unit: `{module-name}.test.ts` (e.g., `task-status.test.ts`, `llm-output-repair.test.ts`)
- E2E: `{feature-name}.spec.ts` (e.g., `agent-lifecycle.spec.ts`, `tasks-crud.spec.ts`)

**Structure:**
```
src/lib/__tests__/          # 69 unit test files
  task-status.test.ts
  llm-output-repair.test.ts
  skill-security.test.ts
  ...

tests/                      # 84 E2E spec files
  helpers.ts                # Shared factories + cleanup
  agent-lifecycle.spec.ts
  tasks-crud.spec.ts
  auth-guards.spec.ts
  ...
  fixtures/openclaw/        # Mock CLI fixtures
```

## Test Structure

**Unit Test Pattern:**
```typescript
import { describe, expect, it } from 'vitest'
import { normalizeTaskCreateStatus } from '../task-status'

describe('task status normalization', () => {
  it('sets assigned status on create when assignee is present', () => {
    expect(normalizeTaskCreateStatus(undefined, 'main')).toBe('assigned')
  })

  it('keeps explicit non-inbox status on create', () => {
    expect(normalizeTaskCreateStatus('in_progress', 'main')).toBe('in_progress')
  })
})
```

**E2E Test Pattern:**
```typescript
import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent } from './helpers'

test.describe('Agent Lifecycle', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestAgent(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  test('GET soul returns content for agent', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.get(`/api/agents/${id}/soul`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('agent')
    expect(body.agent.id).toBe(id)
  })
})
```

**Patterns:**
- Unit: No setup/teardown for pure functions; `beforeEach`/`afterEach` for stateful tests
- E2E: Cleanup array pattern — push IDs in test, delete in `afterEach`
- Assertions: `.toBe()` for primitives, `.toHaveProperty()` for structure, `.toContain()` for arrays
- One logical assertion per test, but multiple `expect()` calls OK

## Mocking

**Unit Tests:**
- Vitest jsdom environment with `MISSION_CONTROL_TEST_MODE=1`
- No explicit mock framework (tests use live in-memory SQLite)
- `vi.mock()` for module mocking when needed

**E2E Tests:**
- Live API calls against running server (`http://127.0.0.1:3005`)
- No HTTP mocking — tests call real endpoints
- Playwright `request` fixture for API interactions

**Test Helpers (`tests/helpers.ts`):**
```typescript
export const API_KEY_HEADER = {
  'x-api-key': 'test-api-key-e2e-12345',
  'Content-Type': 'application/json'
}

export async function createTestTask(request, overrides?) { ... }
export async function deleteTestTask(request, id) { ... }
export async function createTestAgent(request, overrides?) { ... }
export async function deleteTestAgent(request, id) { ... }
export async function createTestWorkflow(request, overrides?) { ... }
export async function createTestWebhook(request, overrides?) { ... }
```

**OpenClaw Fixtures:**
- Mock CLI binaries: `scripts/e2e-openclaw/bin/{openclaw,clawdbot}`
- Mock gateway: `scripts/e2e-openclaw/mock-gateway.mjs`
- Fixture files: `tests/fixtures/openclaw/`

## Coverage

**Configuration (vitest.config.ts):**
- Provider: v8
- Included: `src/lib/**/*.ts` only
- Excluded: 79 items (server-side orchestration, DB-dependent, adapters, migrations, client hooks)
- Thresholds: 60% across lines, functions, branches, statements

**View:**
```bash
pnpm test -- --coverage
```

## Test Types

**Unit Tests (69 files, ~1,795 tests):**
- Scope: Single function/module in isolation
- Speed: Fast (jsdom, in-memory SQLite)
- Examples: `task-status.test.ts`, `llm-output-repair.test.ts`, `skill-security.test.ts`

**E2E Tests (84 files):**
- Scope: Full API lifecycle (create → verify → cleanup)
- Categories:
  - Security & Auth: 6 specs (auth-guards, csrf-validation, rate-limiting, timing-safe-auth)
  - CRUD Lifecycle: 6 specs (tasks, agents, comments, workflows, webhooks, alerts, users)
  - Features: 3 specs (notifications, quality-review, search-and-export)
  - Infrastructure: 2 specs (limit-caps, delete-body)
  - OpenClaw: Harness tests (offline mode)
- Server auto-starts: `reuseExistingServer: true`
- Test mode: `MISSION_CONTROL_TEST_MODE=1`, `MC_DISABLE_RATE_LIMIT=1`
- Test credentials: `AUTH_USER=testadmin`, `AUTH_PASS=testpass1234!`

## CI Pipeline

**Workflow:** `.github/workflows/quality-gate.yml`

**Steps:**
1. Checkout
2. Setup pnpm v10
3. Setup Node from `.nvmrc` with pnpm cache
4. `pnpm install --frozen-lockfile`
5. `pnpm lint`
6. `pnpm typecheck`
7. `pnpm test` (unit)
8. Copy `.env.test` to `.env`
9. `pnpm build`
10. Install Playwright browsers
11. `pnpm test:e2e`

**Concurrency:** Single job, concurrency group prevents parallel runs

## Skipped Tests

6 skipped tests to investigate:
- `tests/gateway-config.spec.ts:67` — Config file not available
- `tests/super-admin.spec.ts:222` — Skipped
- `tests/device-identity.spec.ts` — 4 skipped tests (lines 66, 104, 137, 204)

---

*Testing analysis: 2026-03-15*
*Update when test patterns change*
