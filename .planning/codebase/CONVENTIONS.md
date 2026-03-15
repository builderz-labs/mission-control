# Coding Conventions

**Analysis Date:** 2026-03-15

## Naming Patterns

**Files:**
- `kebab-case.ts` for all source files (`task-status.ts`, `agent-sync.ts`, `use-focus-trap.ts`)
- `*.test.ts` for unit tests (`task-status.test.ts`, `llm-output-repair.test.ts`)
- `*.spec.ts` for E2E tests (`agent-lifecycle.spec.ts`, `tasks-crud.spec.ts`)
- `route.ts` for API endpoints (Next.js App Router convention)

**Functions:**
- `camelCase` for all functions (`formatUptime()`, `getStatusColor()`, `checkAgentBudget()`)
- No special prefix for async functions
- `SCREAMING_SNAKE_CASE` for constants (`SESSION_DURATION`, `MC_SESSION_COOKIE_NAME`)

**Variables:**
- `camelCase` for variables and function parameters
- `SCREAMING_SNAKE_CASE` for module-level constants
- No underscore prefix convention

**Types:**
- `PascalCase` for interfaces and types (`User`, `Session`, `Agent`, `ChatMessage`)
- `{Name}Row` suffix for database row types (`ClaudeSessionRow`, `SettingRow`, `SessionQueryRow`)
- `{Name}Props` suffix for component props (`OnlineStatusProps`, `LoaderProps`)
- `{name}Schema` for Zod schemas (`createTaskSchema`, `updateTaskSchema`)

**Database:**
- `snake_case` for tables (`quality_reviews`, `user_sessions`, `workflow_templates`, `audit_log`)
- `snake_case` for columns (`task_id`, `assigned_to`, `created_at`, `is_active`)
- `_id` suffix for foreign keys (`user_id`, `workspace_id`, `tenant_id`)
- `idx_{table}_{column(s)}` for indexes (`idx_quality_reviews_task_id`)

## Code Style

**Formatting:**
- ESLint only (no Prettier config)
- Single quotes for strings
- 2-space indentation
- Semicolons (implicit via ESLint defaults)

**Linting:**
- ESLint flat config: `eslint.config.mjs`
- Extends: `eslint-config-next`
- Ignores: `.data/**`, `ops/**`
- Disabled for React 19 settling: `react-hooks/set-state-in-effect`, `react-hooks/purity`, `react-hooks/immutability`
- Run: `pnpm lint`

## Import Organization

**Order:**
1. Node.js built-ins (`node:crypto`, `node:fs`, `node:path`)
2. External packages (`next/server`, `react`, `zustand`, `zod`)
3. Internal modules via path alias (`@/lib/db`, `@/lib/auth`, `@/types`)
4. Type imports (`import type { User }`)

**Path Aliases:**
- `@/*` maps to `./src/*` (configured in `tsconfig.json`)
- All imports use `@/` prefix — no relative imports in production code

## Error Handling

**API Route Pattern:**
```typescript
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, schema)
  if ('error' in result) return result.error

  // ... business logic
  return NextResponse.json({ data })
}
```

**Patterns:**
- Discriminated union: `requireRole()` returns `{ user } | { error, status }`
- Validation: `validateBody()` returns `{ data } | { error: NextResponse }`
- Early return on error — no nested if/else chains
- try/catch at API boundary, logging via pino before returning 500

**Error Types:**
- `User | null` for missing entities
- `NextResponse` for HTTP errors (returned directly)
- Standard `Error` class (no custom error hierarchy)

## Logging

**Framework:**
- Server: pino (`src/lib/logger.ts`) — structured JSON logging
- Client: Abstraction in `src/lib/client-logger.ts` (wraps console.debug/warn/error)

**Patterns:**
- Structured: `logger.info({ userId, action }, 'User action')`
- Context objects before message string
- No `console.log` in production code (all abstracted)

## Comments

**When to Comment:**
- Explain "why", not "what": `// Retry 3 times because API has transient failures`
- Explain N+1 prevention: `// Prepare source detail statements once (avoids N+1)`
- Minimal JSDoc — only for complex public functions
- Single-line comments above non-obvious logic

**TODO Comments:**
- Rare (only 1 found: `src/lib/__tests__/skill-security.test.ts`)
- No tracking convention

**Commit Messages:**
- Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`
- Scope in parens: `fix(i18n):`, `fix(ui):`, `fix(tasks):`
- No `Co-Authored-By` trailers (per CLAUDE.md)

## Function Design

**Parameters:**
- Destructured in component functions: `function Component({ prop1, prop2 }: Props)`
- Options object for complex functions
- `request: NextRequest` as first param in API routes

**Return Values:**
- Early return for guard clauses
- `NextResponse.json()` for API responses (no wrapper utility)
- `null` for "not found" cases

## Module Design

**Exports:**
- Named exports preferred for library modules
- `export function` for public API
- `export type`/`export interface` for types

**Client Components:**
- 94 components with `'use client'` directive
- All interactive UI components are client components
- Pages and layouts default to server components

**Store Pattern:**
- Single Zustand store (`src/store/index.ts`) with `subscribeWithSelector`
- Full TypeScript coverage with exported interfaces
- localStorage for persistent UI preferences

---

*Convention analysis: 2026-03-15*
*Update when patterns change*
