# Mission Control

Open-source dashboard for AI agent orchestration. Manage agent fleets, track tasks, monitor costs, and orchestrate workflows.

**Stack**: Next.js 16, React 19, TypeScript 5, SQLite (better-sqlite3), Tailwind CSS 3, Zustand, pnpm

## Prerequisites

- Node.js >= 22 (LTS recommended; 24.x also supported)
- pnpm (`corepack enable` to auto-install)

## Setup

```bash
pnpm install
pnpm build
```

Secrets (AUTH_SECRET, API_KEY) auto-generate on first run if not set.
Visit `http://localhost:3000/setup` to create an admin account, or set `AUTH_USER`/`AUTH_PASS` in `.env` for headless/CI seeding.

## Run

```bash
pnpm dev              # development (localhost:3000)
pnpm start            # production
node .next/standalone/server.js   # standalone mode (after build)
```

## Docker

```bash
docker compose up                 # zero-config
bash install.sh --docker          # full guided setup
```

Production hardening: `docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d`

## Tests

```bash
pnpm test             # unit tests (vitest)
pnpm test:e2e         # end-to-end (playwright)
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
pnpm test:all         # lint + typecheck + test + build + e2e
```

## Key Directories

```
src/app/          Next.js pages + API routes (App Router)
src/components/   UI panels and shared components
src/lib/          Core logic, database, utilities
.data/            SQLite database + runtime state (gitignored)
scripts/          Install, deploy, diagnostics scripts
docs/             Documentation and guides
```

Path alias: `@/*` maps to `./src/*`

## Data Directory

Set `MISSION_CONTROL_DATA_DIR` env var to change the data location (defaults to `.data/`).
Database path: defaults to `<MISSION_CONTROL_DATA_DIR>/mission-control.db`.

## Fork Extension Env Vars

Fork-only env vars consumed by extensions under `src/extensions/`:

- `MC_FLEET_CLUSTER_NAME` — ECS cluster name the Fleet panel reads (`ecs:ListServices` + `ecs:DescribeServices`). Defaults to `ender-stack-dev`. Used only by the `fleet/` extension; ignored on non-AWS deployments.
- `AWS_REGION` — read by the Fleet panel's `ECSClient`. Set automatically by Fargate task metadata; falls back to `us-east-1` for local dev.

## Conventions

- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`)
- **No AI attribution**: Never add `Co-Authored-By` or similar trailers to commits
- **Package manager**: pnpm only (no npm/yarn)
- **Icons**: No icon libraries -- use raw text/emoji in components
- **Standalone output**: `next.config.js` sets `output: 'standalone'`

## Agent Control Interfaces

Mission Control provides three interfaces for autonomous agents:

### MCP Server (recommended for agents)
```bash
# Add to any Claude Code agent:
claude mcp add mission-control -- node /path/to/mission-control/scripts/mc-mcp-server.cjs

# Environment config:
MC_URL=http://127.0.0.1:3000 MC_API_KEY=<key>
```
35 tools: agents, tasks, sessions, memory, soul, comments, tokens, skills, cron, status.
See `docs/cli-agent-control.md` for full tool list.

### CLI
```bash
pnpm mc agents list --json
pnpm mc tasks queue --agent Aegis --max-capacity 2 --json
pnpm mc events watch --types agent,task
```

### REST API
OpenAPI spec: `openapi.json`. Interactive docs at `/docs` when running.

## Branch & PR Workflow (AMS Fork)

**Always `git fetch origin` before branching**, then branch from `origin/<starting-branch>` — not from a local ref that may be behind remote. The starting branch is typically `main` but can be any intended base (feature branch, release branch, etc.).

```bash
git fetch origin
git checkout -b feat/my-feature origin/main   # ← origin/<starting-branch>, not local ref
```

Local branches drift as PRs merge. Always resolve to the remote ref explicitly so you start from the actual current state.

If a branch falls behind after new commits land on the starting branch:

```bash
# Create a clean replacement branch from the current remote starting branch
git fetch origin
git checkout -b feat/my-feature-v2 origin/main   # or origin/<whatever the base is>
git cherry-pick <sha1> <sha2> ...   # replay only your commits
git push origin feat/my-feature-v2
# Close the stale PR, open a fresh one from the new branch
```

Never rebase a branch that already has an open PR without first checking for conflict risk. Cherry-pick onto a fresh branch is safer and produces a clean diff.

## Common Pitfalls

- **Standalone mode**: Use `node .next/standalone/server.js`, not `pnpm start` (which requires full `node_modules`)
- **better-sqlite3**: Native addon -- needs rebuild when switching Node versions (`pnpm rebuild better-sqlite3`)
- **AUTH_PASS with `#`**: Quote it (`AUTH_PASS="my#pass"`) or use `AUTH_PASS_B64` (base64-encoded)
- **Gateway optional**: Set `NEXT_PUBLIC_GATEWAY_OPTIONAL=true` for standalone deployments without gateway connectivity

## Test Discipline (HARD RULE)

Every PR must leave test coverage **equal or better** than it found it. The quality-gate CI enforces lint, typecheck, unit tests, build, and E2E on every PR — no merge without green.

### Rules

1. **New feature → new tests.** If you add a component, route, API handler, or extension, add unit tests. If you add user-visible behavior, add or extend E2E tests. No "I'll add tests later."

2. **Bug fix → regression test first.** Write the test that reproduces the bug, confirm it fails, then fix. The test stays.

3. **Fork-extension changes → fork-regression tests.** Any change under `src/extensions/` must be covered by tests in `src/extensions/__tests__/`. The existing suite covers:
   - `manifest-registration.test.ts` — scheduled tasks, API routes, panel registration, nav Symbol guard
   - `client-boot.test.tsx` — onboarding suppression contract
   - `fork-contract.test.ts` — upstream byte-clean ratchet (allowlist in `fixtures/approved-upstream-paths.ts`)
   - `fleet/__tests__/slack-credentials.test.ts` — SecretsManager naming pattern
   
   If your change adds a new extension, scheduled task, panel, or upstream touch point, update these tests.

4. **Upstream touch-point changes → update the allowlist.** If you legitimately need to modify a file outside `src/extensions/`, add it to `src/extensions/__tests__/fixtures/approved-upstream-paths.ts` with a tagged comment (documented override / intentional addition / LEGACY DEBT) and update FORK.md. The fork-contract test will block your PR otherwise.

5. **Golden datasets for config generation.** When Mission Control generates agent configs (openclaw.json via fleet templates), the expected output for known inputs should be captured as fixture files. Test that the template produces the expected shape.

6. **API contract tests stay current.** The `API contract parity` CI step validates extension routes match expectations. When you add or change an API route, update the contract fixture.

### Test commands

_See [Tests](#tests) above._ Use `pnpm test:all` for the full gate locally.

### Test inventory (keep current)

| Layer | Location | What it covers |
|-------|----------|---------------|
| Fork regression | `src/extensions/__tests__/` | Manifest, client-boot, fork-contract, fixtures |
| Extension unit | `src/extensions/<area>/__tests__/` | Per-extension logic (fleet, oap, resolver, etc.) |
| Upstream unit | `src/lib/__tests__/`, `src/app/api/**/__tests__/` | Core lib + API routes |
| E2E | `tests/` (Playwright) | Full browser flows |
| CI contract | Quality Gate workflow | Lint, typecheck, unit, build, E2E |

When you add a new test file or area, update this table.
