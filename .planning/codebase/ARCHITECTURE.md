# Architecture

**Analysis Date:** 2026-03-15

## Pattern Overview

**Overall:** Modular Monolith — Full-stack Next.js App Router with embedded SQLite

**Key Characteristics:**
- Single deployable: standalone Node.js server (no external DB required)
- 158 API route files across 177 directories
- 33 UI panels with modular dashboard layout
- Real-time updates via SSE (Server-Sent Events)
- Multi-tenant RBAC with workspace isolation
- Plugin system for agent framework adapters
- Tiered LLM router (fast/standard/complex) with per-agent budget enforcement

## Layers

**Presentation Layer (UI):**
- Purpose: Dashboard panels, forms, and real-time displays
- Contains: 94 client components (`'use client'`), server components for pages/layouts
- Location: `src/components/` (panels, layout, UI primitives, onboarding)
- Depends on: Zustand store, API routes via fetch
- Used by: Next.js App Router pages

**API Layer (Routes):**
- Purpose: RESTful endpoints for all CRUD, auth, and orchestration operations
- Contains: 158 route.ts files with GET/POST/PUT/DELETE handlers
- Location: `src/app/api/`
- Depends on: Auth layer, database layer, validation layer
- Used by: UI components, external agents, CLI tools

**Auth Layer:**
- Purpose: Authentication (session + API key + agent keys) and RBAC authorization
- Contains: `getUserFromRequest()`, `requireRole()`, session management, password hashing
- Location: `src/lib/auth.ts`, `src/lib/password.ts`, `src/proxy.ts` (middleware)
- Depends on: Database layer, crypto
- Used by: All protected API routes

**Business Logic Layer:**
- Purpose: Core orchestration logic, agent management, workflow execution
- Contains: Services, schedulers, event bus, LLM router, consensus engine
- Location: `src/lib/` (100+ modules)
- Depends on: Database layer, external adapters
- Used by: API routes, scheduled tasks

**Data Layer:**
- Purpose: SQLite database access, migrations, schema management
- Contains: `getDatabase()`, prepared statements, transaction wrappers, 57 migrations
- Location: `src/lib/db.ts`, `src/lib/migrations.ts`, `src/lib/schema.sql`
- Depends on: `better-sqlite3`, file system
- Used by: All business logic and API routes

**Adapter Layer:**
- Purpose: Framework-specific agent integration
- Contains: Adapters for AutoGen, CrewAI, LangGraph, Claude SDK, OpenClaw, Generic
- Location: `src/lib/adapters/`
- Depends on: External agent frameworks
- Used by: Agent management and orchestration

## Data Flow

**HTTP Request (API):**

1. Request hits Next.js middleware (`src/proxy.ts`)
2. Host validation + CSP nonce generation + security headers added
3. Session/API key extraction for auth check
4. Route handler invoked (`src/app/api/[...]/route.ts`)
5. `requireRole(request, 'admin'|'operator'|'viewer')` checks authorization
6. Zod schema validates request body
7. Business logic executes (database queries, LLM calls, etc.)
8. `NextResponse.json()` returns result

**Real-time Updates (SSE):**

1. Client connects to SSE endpoint (e.g., `/api/virtual-office/stream`)
2. Server creates readable stream with abort listener
3. EventBus dispatches events (agent status, task updates, etc.)
4. Zustand store receives updates via `use-server-events.ts` hook
5. React components re-render from store selectors

**LLM Inference:**

1. Task requires AI processing (summarization, routing, etc.)
2. `getTierForTask()` selects fast/standard/complex tier
3. `getModelForTier()` maps to configured model (Anthropic/OpenAI/Ollama)
4. Budget check: `checkAgentBudget()` enforces per-agent daily spend limit
5. Rate limiter checks per-agent call frequency
6. Adapter `complete()` fires, token usage logged to `token_usage` table

**State Management:**
- Server: SQLite database (`.data/mission-control.db`) — single source of truth
- Client: Zustand store (`src/store/index.ts`) with `subscribeWithSelector` middleware
- Persistence: localStorage for UI preferences (active tab, sidebar, layout)
- Real-time sync: SSE events update Zustand store → React re-renders

## Key Abstractions

**Route Handler Pattern:**
- Purpose: Consistent API endpoint structure
- Pattern: `requireRole()` → `validateBody()` → `getDatabase()` → `NextResponse.json()`
- Examples: `src/app/api/tasks/route.ts`, `src/app/api/agents/route.ts`

**Event Bus:**
- Purpose: Decouple producers from consumers for real-time events
- Location: `src/lib/event-bus.ts`
- Pattern: Publish/subscribe with typed events
- Used by: SSE streams, webhooks, notifications

**Plugin/Adapter System:**
- Purpose: Framework-agnostic agent integration
- Location: `src/lib/adapters/`, `src/lib/plugin-loader.ts`, `src/lib/plugins.ts`
- Pattern: Interface-based adapters with registration
- Examples: `AnthropicAdapter`, `OpenAICompatibleAdapter`

**Migration System:**
- Purpose: Schema evolution with idempotent DDL
- Location: `src/lib/migrations.ts` (57 migrations, `001_init` through `057_*`)
- Pattern: Sequential numbered migrations tracked in `schema_migrations` table

**Skill Registry:**
- Purpose: Search, download, and security-scan skills from external registries
- Location: `src/lib/skill-registry.ts`
- Sources: ClawdHub, skills.sh, Awesome OpenClaw

## Entry Points

**Web Application:**
- Location: `src/app/layout.tsx` → `src/app/page.tsx`
- Triggers: Browser request to `/`
- Responsibilities: Render dashboard with panels, connect SSE

**API Routes:**
- Location: `src/app/api/[endpoint]/route.ts` (158 files)
- Triggers: HTTP requests from UI, agents, or external tools
- Responsibilities: CRUD, orchestration, auth, real-time events

**Middleware (Proxy):**
- Location: `src/proxy.ts` (exported as `middleware` for Next.js)
- Triggers: Every incoming request
- Responsibilities: Host validation, CSP nonces, security headers, session extraction

**Standalone Server:**
- Location: `.next/standalone/server.js`
- Triggers: `node server.js` or `scripts/start-standalone.sh`
- Responsibilities: Production HTTP server

## Error Handling

**Strategy:** Discriminated union returns at API boundary, try/catch at service level

**Patterns:**
- Auth errors: `if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })`
- Validation errors: `validateBody()` returns `{ data: T } | { error: NextResponse }`
- Rate limiting: `mutationLimiter(request)` returns `NextResponse` or null
- Database errors: try/catch with pino logging, 500 response
- 985 try/catch blocks across API routes

## Cross-Cutting Concerns

**Logging:**
- Server: pino structured logger (`src/lib/logger.ts`)
- Client: Client logger abstraction (`src/lib/client-logger.ts`)
- Pattern: `logger.info({ context }, 'message')` — structured with context object

**Validation:**
- Zod schemas at API boundary (`src/lib/validation.ts`)
- 220+ Zod validation instances across routes
- Pattern: `validateBody(request, schema)` → discriminated union

**Authentication:**
- Multi-method: Session cookie → API key → Agent keys → Plugin hook
- `MC_DISABLE_AUTH=1` bypass for local dashboard mode
- `requireRole(request, role)` used consistently across 55+ routes

**Rate Limiting:**
- In-memory with periodic cleanup (`src/lib/rate-limit.ts`)
- IP extraction from `X-Forwarded-For`, `X-Real-IP` headers
- `mutationLimiter()` for write operations

**Security:**
- CSP with per-request nonces (`src/lib/csp.ts`)
- Timing-safe comparisons (`crypto.timingSafeEqual`)
- HMAC SHA256 webhook signatures
- X-Frame-Options: DENY, X-Content-Type-Options: nosniff

**i18n:**
- `next-intl` integration (`src/i18n/`)
- Cookie and header-based locale detection

---

*Architecture analysis: 2026-03-15*
*Update when major patterns change*
