# Codebase Concerns

**Analysis Date:** 2026-03-15

## Tech Debt

**TypeScript `any` Usage (240 instances):**
- Issue: 240 instances of `: any` or `as any` across codebase, plus 32 `catch (err: any)` blocks
- Files: `src/index.ts` (8+), `src/lib/super-admin.ts` (13+), `src/lib/security-events.ts` (4+), `src/lib/migrations.ts` (3+), many catch blocks
- Why: Rapid development, SQLite query results lack type inference
- Impact: Loss of type safety in error handling, migrations, and database operations
- Fix approach: Replace `any` with `unknown` in catch blocks, add proper type assertions for DB results

**Mega-Components (8 files > 500 lines):**
- Issue: Several components are excessively large, making them hard to test and maintain
- Files:
  - `src/components/panels/agent-detail-tabs.tsx` — **2,951 lines**
  - `src/components/panels/office-panel.tsx` — **2,411 lines**
  - `src/components/panels/task-board-panel.tsx` — **2,222 lines**
  - `src/components/panels/cron-management-panel.tsx` — **1,626 lines**
  - `src/components/layout/nav-rail.tsx` — **1,502 lines**
  - `src/lib/migrations.ts` — **1,287 lines** (57 migrations)
  - `src/components/panels/token-dashboard-panel.tsx` — **1,197 lines**
  - `src/store/index.ts` — **1,146 lines** (monolithic Zustand store)
- Why: Organic growth without decomposition
- Impact: High cognitive load, difficult to isolate bugs, limits parallelization of work
- Fix approach: Extract sub-components per tab/section; split store into feature slices

**Monolithic Zustand Store:**
- Issue: Single store file at 1,146 lines managing sessions, agents, tasks, logs, cron, memory, tokens, UI
- File: `src/store/index.ts`
- Why: Started small, grew with features
- Impact: All state changes potentially trigger selector re-evaluation; hard to reason about
- Fix approach: Split into feature-specific stores (`useAgentStore`, `useTaskStore`, etc.) — Zustand supports multiple stores naturally

## Known Bugs

**Skipped Tests (6 tests):**
- Symptoms: Tests that should validate functionality aren't running
- Files:
  - `tests/gateway-config.spec.ts:67` — `test.skip(true, 'Config file not available')`
  - `tests/super-admin.spec.ts:222` — `test.skip()`
  - `tests/device-identity.spec.ts` — 4 skipped tests (lines 66, 104, 137, 204)
- Workaround: Functionality works but lacks automated verification
- Root cause: Missing test prerequisites or incomplete feature implementation

## Security Considerations

**SQL Injection — LOW RISK:**
- Risk: Raw SQL execution could introduce injection
- Current mitigation: All data queries use `db.prepare().run()` with `?` placeholders. 195 `db.exec()` calls are all in migrations with literal strings (safe).
- Recommendations: Continue parameterized query pattern for all new code

**Input Validation Coverage:**
- Risk: Not all 158 API routes may have Zod validation on input
- Current mitigation: 220+ Zod validation instances found across routes; core routes validated
- Recommendations: Audit remaining routes for missing validation; consider middleware-level validation

**CSP & Security Headers — STRONG:**
- Risk: XSS, clickjacking, content sniffing
- Current mitigation: Per-request CSP nonces, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin, timing-safe comparisons
- Recommendations: None — well-implemented

**Auth Bypass (MC_DISABLE_AUTH):**
- Risk: If env var leaks to network-exposed deployment, all auth is bypassed
- Current mitigation: Only safe when bound to `127.0.0.1`; documented in auth.ts comment
- Recommendations: Add startup warning if `MC_DISABLE_AUTH=1` and `HOSTNAME !== 127.0.0.1`

**CORS — NOT CONFIGURED:**
- Risk: No explicit CORS headers found in codebase
- Current mitigation: Same-origin by default (Next.js serves both frontend and API)
- Recommendations: If API is exposed externally, add explicit CORS configuration

## Performance Bottlenecks

**Large Panel Components:**
- Problem: 3 panels exceed 2,000 lines each (agent-detail-tabs, office-panel, task-board)
- Cause: All tab content rendered in single component, potentially causing unnecessary re-renders
- Improvement path: Code-split tabs into lazy-loaded sub-components; extract hooks

**Server-Side Fetch Timeouts:**
- Problem: 29 fetch calls in API routes; not all may have timeout handling
- Current mitigation: Key fetches have timeouts — `github.ts` (custom), `skill-registry.ts` (15s), `webhooks.ts` (10s)
- Improvement path: Audit all 29 fetch instances; standardize timeout utility

## Fragile Areas

**Migrations File (`src/lib/migrations.ts`):**
- Why fragile: 1,287 lines, 57 sequential migrations in a single file
- Common failures: Migration ordering errors, missing migration on schema change
- Safe modification: Always add new migrations at end; never modify existing ones
- Test coverage: Covered by DB initialization tests

**Nav Rail (`src/components/layout/nav-rail.tsx`):**
- Why fragile: 1,502 lines managing panel registration, navigation, settings, themes
- Common failures: Adding new panel requires editing multiple sections
- Safe modification: Extract panel registry into separate config; decompose into sub-components
- Test coverage: E2E coverage only

## Scaling Limits

**SQLite Concurrent Writes:**
- Current capacity: Single writer at a time (WAL mode allows concurrent reads)
- Limit: High-concurrency multi-user scenarios
- Symptoms at limit: "database is locked" errors (acknowledged in test: `intervention-executor.test.ts:316-323`)
- Scaling path: Documented limitation; intended for single-server deployment. For scaling: migrate to PostgreSQL

**SSE Connection Count:**
- Current capacity: Limited by Node.js process file descriptor limit
- Limit: ~1000 concurrent SSE connections per process (OS default)
- Scaling path: Add connection pooling or switch to WebSocket with multiplexing

## Dependencies at Risk

**better-sqlite3 (Native Addon):**
- Risk: Requires rebuild when switching Node versions; compilation failures on some platforms
- Impact: Application won't start if native module is incompatible
- Migration plan: `pnpm rebuild better-sqlite3` on Node upgrade; documented in CLAUDE.md

**React 19 (Settling Period):**
- Risk: 3 ESLint rules disabled for React 19 settling (`react-hooks/set-state-in-effect`, `purity`, `immutability`)
- Impact: Potential missed hook violations during settling period
- Migration plan: Re-enable rules after React 19 stabilizes; lint will catch violations

## Missing Critical Features

*Note: This section captures gaps relevant to the planned agent platform extension.*

**No Spatial Visualization:**
- Problem: No 2D spatial representation of agent interactions
- Current workaround: Flat panel list in nav-rail
- Blocks: Can't visualize agent relationships, message flows, or team topology
- Note: `@xyflow/react` already in dependencies — ready to use

**No Structured Workflow Engine:**
- Problem: No MetaGPT-style SOP phase/artifact pipeline
- Current workaround: Manual task assignment and tracking
- Blocks: Can't enforce artifact handoff between agent phases

**No Debate/Consensus UI:**
- Problem: No structured multi-agent deliberation view
- Current workaround: Chat messages without structured debate protocol
- Blocks: Can't visualize argument structure, voting, or consensus formation

**No Deep Persona System:**
- Problem: No Big Five personality traits, emotional state, or cognitive bias simulation
- Current workaround: Agents have basic "soul" text description only
- Blocks: Can't simulate realistic multi-agent interactions

**No Auto-Scaling:**
- Problem: No mechanism for agents to detect overload and request new agents
- Current workaround: Manual agent creation
- Blocks: Can't achieve self-organizing agent teams

## Test Coverage Gaps

**Component Tests:**
- What's not tested: No unit tests for any React components (only E2E covers UI)
- Risk: Component-level bugs only caught by E2E (slow feedback)
- Priority: Low (E2E provides functional coverage)
- Difficulty: Would need to mock Zustand stores and API calls

**Missing Error.tsx:**
- What's not tested: No global error boundary (`src/app/error.tsx` missing)
- Risk: Unhandled client-side errors show white screen
- Priority: Medium
- Difficulty: Low (standard Next.js error boundary)

**LLM Integration:**
- What's not tested: LLM router budget enforcement and tier selection only partially tested
- Risk: Budget overruns or wrong model tier selection
- Priority: Medium
- Difficulty: Need mock LLM adapter in test setup

---

*Concerns audit: 2026-03-15*
*Update as issues are fixed or new ones discovered*
