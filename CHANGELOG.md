# Changelog

All notable changes to Mission Control are documented in this file.

## [1.3.0] - 2026-03-02

### Added
- Local Claude Code session tracking — auto-discovers sessions from `~/.claude/projects/`, extracts token usage, model info, cost estimates, and active status from JSONL transcripts
- `GET/POST /api/claude/sessions` endpoint with filtering, pagination, and aggregate stats
- Webhook retry system with exponential backoff and circuit breaker
- `POST /api/webhooks/retry` endpoint for manual retry of failed deliveries
- `GET /api/webhooks/verify-docs` endpoint for signature verification documentation
- Webhook signature verification unit tests (HMAC-SHA256 + backoff logic)
- Docker HEALTHCHECK directive
- Vitest coverage configuration (v8 provider, 60% threshold)
- Cron job deduplication on read and duplicate prevention on add
- `MC_CLAUDE_HOME` env var for configuring Claude Code home directory
- `MC_TRUSTED_PROXIES` env var for rate limiter IP extraction

### Fixed
- Timing-safe comparison bug in webhook signature verification (was comparing buffer with itself)
- Timing-safe comparison bug in auth token validation (same issue)
- Rate limiter IP spoofing — now uses rightmost untrusted IP from X-Forwarded-For chain
- Model display bug: `getModelInfo()` always returned first model (haiku) for unrecognized names
- Feed item ID collisions between logs and activities in the live feed
- WebSocket reconnect thundering-herd — added jitter to exponential backoff

### Changed
- All 31 API routes now use structured pino logger instead of `console.error`/`console.warn`
- Cron file I/O converted from sync to async (`fs/promises`)
- Password minimum length increased to 12 characters
- Zod validation added to `PUT /api/tasks` bulk status updates
- README updated with 64 API routes, new features, and env vars
- Migration count: 20 (added `claude_sessions` table)
- 69 unit tests, 165 E2E tests — all passing

### Contributors
- @TGLTommy — model display bug fix
- @doanbactam — feed ID fix, jittered reconnect, cron deduplication

## [1.2.0] - 2026-03-01

### Added
- Zod input validation schemas for all mutation API routes
- Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- Rate limiting on resource-intensive endpoints (search, backup, cleanup, memory, logs)
- Unit tests for auth, validation, rate-limit, and db-helpers modules

### Fixed
- Task status enum mismatch (`blocked` → `quality_review`) in validation schema
- Type safety improvements in auth.ts and db.ts (replaced `as any` casts)

### Changed
- Standardized alert route to use `validateBody()` helper
- Bumped package version from 1.0.0 to 1.2.0

## [1.1.0] - 2026-02-27

### Added
- Multi-user authentication with session management
- Google SSO with admin approval workflow
- Role-based access control (admin, operator, viewer)
- Audit logging for security events
- 1Password integration for secrets management
- Workflow templates and pipeline orchestration
- Quality review system with approval gates
- Data export (CSV/JSON) for audit logs, tasks, activities
- Global search across all entities
- Settings management UI
- Gateway configuration editor
- Notification system with @mentions
- Agent communication (direct messages)
- Standup report generation
- Scheduled auto-backup and auto-cleanup
- Network access control (host allowlist)
- CSRF origin validation

## [1.0.0] - 2026-02-15

### Added
- Agent orchestration dashboard with real-time status
- Task management with Kanban board
- Activity stream with live updates (SSE)
- Agent spawn and session management
- Webhook integration with HMAC signatures
- Alert rules engine with condition evaluation
- Token usage tracking and cost estimation
- Dark/light theme support
- Docker deployment support
