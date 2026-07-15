# E2E Tests

Playwright end-to-end specs for Mission Control API and UI.

## Running

```bash
# Start the dev server first (or let Playwright auto-start via reuseExistingServer)
pnpm dev --hostname 127.0.0.1 --port 3005

# Run all tests
pnpm test:e2e

# Run offline OpenClaw harness (no OpenClaw install required)
pnpm test:e2e:openclaw

# Run a specific spec
pnpm exec playwright test tests/tasks-crud.spec.ts
```

## Test Environment

Tests require `.env.local` with:
- `API_KEY=test-api-key-e2e-12345`
- `MC_DISABLE_RATE_LIMIT=1` (bypasses mutation/read rate limits, keeps login rate limit active)

## OpenClaw Offline Harness

The harness runs Mission Control against fixture data and mock binaries/gateway:
- fixtures: `tests/fixtures/openclaw/`
- mock CLI: `scripts/e2e-openclaw/bin/{openclaw,clawdbot}`
- mock gateway: `scripts/e2e-openclaw/mock-gateway.mjs`

Profiles:
- `pnpm test:e2e:openclaw:local` - local mode (gateway not running)
- `pnpm test:e2e:openclaw:gateway` - gateway mode (mock gateway running)

## Spec Files

### Security & Auth
- `auth-guards.spec.ts` — All API routes return 401 without auth
- `csrf-validation.spec.ts` — CSRF origin header validation
- `legacy-cookie-removed.spec.ts` — Old cookie format rejected
- `login-flow.spec.ts` — Login, session, redirect lifecycle
- `rate-limiting.spec.ts` — Login brute-force protection
- `timing-safe-auth.spec.ts` — Constant-time API key comparison
- `workspace-isolation.spec.ts` — Real HTTP denial of cross-workspace list, search, read, update, and delete attempts

### CRUD Lifecycle
- `tasks-crud.spec.ts` — Tasks POST/GET/PUT/DELETE with filters, Aegis gate
- `agents-crud.spec.ts` — Agents CRUD, lookup by name/id, admin-only delete
- `task-comments.spec.ts` — Threaded comments on tasks
- `workflows-crud.spec.ts` — Workflow template CRUD
- `webhooks-crud.spec.ts` — Webhooks with secret masking and regeneration
- `alerts-crud.spec.ts` — Alert rule CRUD with full lifecycle
- `user-management.spec.ts` — User admin CRUD

### Features
- `notifications.spec.ts` — Notification delivery and read tracking
- `quality-review.spec.ts` — Quality reviews with batch lookup
- `search-and-export.spec.ts` — Global search, data export, activity feed

### Infrastructure
- `limit-caps.spec.ts` — Endpoint limit caps enforced
- `delete-body.spec.ts` — DELETE body standardization

### Shared
- `helpers.ts` — Factory functions (`createTestTask`, `createTestAgent`, etc.) and cleanup helpers
