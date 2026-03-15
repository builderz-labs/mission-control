# External Integrations

**Analysis Date:** 2026-03-15

## APIs & External Services

**LLM Providers:**
- Anthropic Claude — AI inference for agent tasks
  - SDK/Client: `@anthropic-ai/sdk` via `src/lib/llm/adapters/anthropic.ts`
  - Auth: API key in env var (provider-specific)
  - Tiered routing: fast (Haiku), standard (Sonnet), complex (Opus)
- OpenAI-compatible — Alternative LLM providers
  - SDK/Client: Custom adapter `src/lib/llm/adapters/openai-compatible.ts`
  - Supports: OpenAI, Ollama (localhost:11434), any OpenAI-compatible API
  - Auth: API key or none (Ollama)
- Budget enforcement: Per-agent daily spend limit via `checkAgentBudget()`
- Token usage tracked in `token_usage` table

**Agent Framework Integrations:**
- AutoGen — `src/lib/adapters/autogen.ts`
- CrewAI — `src/lib/adapters/crewai.ts`
- LangGraph — `src/lib/adapters/langgraph.ts`
- Claude SDK — `src/lib/adapters/claude-sdk.ts`
- OpenClaw — `src/lib/adapters/openclaw.ts`
- Generic — `src/lib/adapters/generic.ts`

**OpenClaw Gateway:**
- Purpose: External agent runtime management
  - Client: `src/lib/openclaw-gateway.ts` (calls OpenClaw CLI subprocess)
  - Connection: `OPENCLAW_GATEWAY_HOST:OPENCLAW_GATEWAY_PORT` (default `127.0.0.1:18789`)
  - Optional: `NEXT_PUBLIC_GATEWAY_OPTIONAL=true` for standalone without gateway

**Skill Registries:**
- ClawdHub, skills.sh, Awesome OpenClaw — Search and install agent skills
  - Client: `src/lib/skill-registry.ts`
  - Security: Content validation and security scanning on download
  - Auth: Server-side only (no direct browser→registry calls)

**GitHub Integration:**
- Purpose: Repository sync and label mapping
  - Client: `src/lib/github.ts` (REST API via fetch with timeout)
  - Routes: `src/app/api/github/sync/route.ts`
  - Auth: Personal access token or OAuth token

**Google OAuth (optional):**
- Purpose: Social sign-in
  - Config: `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - Route: `src/app/api/auth/google/route.ts`
  - CSP: Dynamically enabled when Google client ID is set

## Data Storage

**Database:**
- SQLite via better-sqlite3 — Embedded, single-file database
  - Connection: `src/lib/db.ts` (singleton, WAL mode)
  - Path: `MISSION_CONTROL_DB_PATH` (default `.data/mission-control.db`)
  - Migrations: 57 numbered migrations in `src/lib/migrations.ts` (tracked in `schema_migrations`)
  - Schema: `src/lib/schema.sql` (135 lines base schema)
  - Pattern: Prepared statements with `?` placeholders, typed results via `as` assertion
  - Cleanup: `process.on('exit')`, `SIGINT`, `SIGTERM` → `closeDatabase()`

**File Storage:**
- Local filesystem only
  - Data dir: `MISSION_CONTROL_DATA_DIR` (default `.data/`)
  - OpenClaw workspace: `OPENCLAW_WORKSPACE_DIR` (memory, knowledge-base)
  - Tokens: `MISSION_CONTROL_TOKENS_PATH` (default `.data/mission-control-tokens.json`)
  - Build phase: Uses temp dir (`MISSION_CONTROL_BUILD_DATA_DIR`)

**Caching:**
- In-memory only (no Redis)
  - Rate limit cache: `Map<string, number[]>` with periodic cleanup interval
  - LLM adapter: Lazy singleton pattern (constructed once per process)
  - Agent call timestamps: `Map<number, number[]>` for rate limiting

## Authentication & Identity

**Auth Provider:**
- Custom built-in auth (`src/lib/auth.ts`)
  - Methods: Username/password, API key, agent keys, plugin hook, proxy header
  - Session: Cookie-based (`MC_SESSION_COOKIE_NAME`) with server-side DB storage
  - Password: Hashed via `src/lib/password.ts` (bcrypt/scrypt pattern)
  - Local mode: `MC_DISABLE_AUTH=1` returns synthetic admin user

**Auth Flow (priority order):**
1. Proxy header (`x-mc-user`) — Trusted reverse proxy
2. Session cookie — Browser-based login
3. API key header (`x-api-key`) — Programmatic access
4. Agent keys — Per-agent authentication
5. Plugin hook — Extension point for custom auth

**Auto-generated Credentials:**
- `src/lib/auto-credentials.ts` — Generates `AUTH_SECRET` and `API_KEY` if not set
- Persisted to `.data/.auto-generated` (mode 0o600)
- Detects placeholder values from `.env.example` and regenerates

## Monitoring & Observability

**Logging:**
- Server: pino structured logger (`src/lib/logger.ts`)
- Client: Abstraction in `src/lib/client-logger.ts`
- Output: stdout/stderr (captured by LaunchAgent to `~/.mission-control-dashboard.log`)

**Health Checks:**
- Status endpoint: `/api/status/route.ts`
- Gateway health: `/api/gateways/health/history/route.ts`
- Health monitoring tracked in `gateway_health_logs` table

**Audit Logging:**
- `logAuditEvent()` for security-sensitive operations (settings changes, user management)
- Stored in `audit_log` table with actor, action, detail, IP address

**Error Tracking:**
- No external error tracking service (Sentry not configured)
- Errors logged via pino to stdout/stderr

## CI/CD & Deployment

**Hosting:**
- Standalone Node.js server (self-hosted)
- Docker via `docker compose` (with optional hardened compose file)
- macOS LaunchAgent for persistent local dashboard (port 8080)

**CI Pipeline:**
- GitHub Actions: `.github/workflows/quality-gate.yml`
- Trigger: PR + push to main
- Steps: lint → typecheck → unit tests → build → E2E tests
- Frozen lockfile: `pnpm install --frozen-lockfile`

## Environment Configuration

**Development:**
- Required: None (auto-generates AUTH_SECRET, API_KEY)
- Optional: `.env` for custom AUTH_USER/AUTH_PASS, LLM provider config
- Setup: `pnpm install && pnpm dev` → http://localhost:3000/setup

**Production:**
- Standalone: `scripts/start-standalone.sh` → `node .next/standalone/server.js`
- Environment: `PORT`, `HOSTNAME`, `NODE_ENV=production`
- Secrets: `.data/.auto-generated` or explicit env vars
- Data: `.data/mission-control.db` (persisted across restarts)

**Test:**
- `.env.test` copied to `.env` during CI
- Test credentials: `AUTH_USER=testadmin`, `AUTH_PASS=testpass1234!`
- Test API key: `test-api-key-e2e-12345`
- Rate limits disabled: `MC_DISABLE_RATE_LIMIT=1`

## Webhooks & Callbacks

**Outgoing:**
- Webhook delivery: `src/lib/webhooks.ts`
  - Verification: HMAC SHA256 signature in `X-MC-Signature` header
  - Retry: Managed via `src/app/api/webhooks/retry/route.ts`
  - Test: `src/app/api/webhooks/test/route.ts`
  - Timeout: 10-second fetch timeout with abort
  - Events: Task updates, agent status changes, system events

**Incoming:**
- No external webhook receivers (all webhook flows are outgoing)

## Real-time Communication

**SSE (Server-Sent Events):**
- Virtual office stream: `src/app/api/virtual-office/stream/route.ts`
- Client hook: `src/lib/use-server-events.ts`
- Pattern: Readable stream with abort listener cleanup
- Events: Agent status updates, task transitions, system notifications

**Hermes (Messaging):**
- Chat/messaging system: `src/app/api/hermes/route.ts`
- Channels: `src/app/api/channels/route.ts`
- Messages: `src/app/api/chat/messages/route.ts`

---

*Integration audit: 2026-03-15*
*Update when adding/removing external services*
