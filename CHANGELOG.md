# Changelog

All notable changes to Mission Control are documented in this file.

<!-- Maintainer note: add entries under [Unreleased] as PRs merge; bump to a version when releasing. -->

## [Unreleased]

### Fixed
- SQLite `SQLITE_BUSY` contention — added `busy_timeout` pragma and guarded build-phase eager DB initialisation (#337)
- Skill registry path traversal and SSRF — extended `SECURITY_RULES` with directory traversal patterns and private-IP/metadata URL detection (#338, #336)

### Tests
- Vitest coverage threshold enforcement — added coverage for pure utility modules to satisfy the 60% global threshold; threshold now passes in CI (#339)

---

## [2.0.1] - 2026-03-13

### Fixed
- HTTP and Tailscale login broken by unconditional HTTPS redirect — replaced with opt-in `NEXT_PUBLIC_FORCE_HTTPS=1` (#309)
- CSP nonce mismatch blocking inline scripts after login — nonce now propagated into SSR request headers (#308, #311)
- Layout inline theme script missing `nonce` attribute, causing CSP violations on chunk loading (#308, #311)
- Task dispatch sending agent display name instead of gateway ID — now resolves `openclawId` from config (#310)
- Session cookie `Secure` flag forced in production even over HTTP — now derived from actual request protocol (#304)
- Node version check changed from allowlist (22, 24) to floor (>=22) for future compatibility

### Changed
- CSP generation and browser-security helpers extracted to `src/lib/csp.ts` and `src/lib/browser-security.ts`

### Contributors
- @0xNyk
- @polaris-dxz
- @jaserNo1

## [2.0.0] - 2026-03-11

### Added
- Dual-mode operations for both OpenClaw gateway deployments and local workstation installs
- Hermes observability, including session, task, cron, memory, and transcript visibility
- Obsidian-style memory knowledge system with graph visualization, health signals, and filesystem browser
- Rebuilt onboarding flow with session-scoped walkthroughs, security scan, and OpenClaw gateway setup guidance
- OpenClaw doctor status and in-app doctor fix workflow for runtime drift detection and remediation
- Expanded OpenClaw dashboard coverage for channels, chat, sessions, cron, usage, devices, approvals, logs, and schema-backed config
- Global exec approval overlay, unified cost tracker, and richer agent communication/session routing views
- Embedded chat workspace, Claude Code task bridge, framework adapters, self-update flow, and stronger local agent/skill discovery
- Automated task dispatch, automated Aegis review, natural-language recurring tasks, and richer gateway backup/update actions

### Fixed
- Agent and workspace deletion now removes OpenClaw config state correctly and refreshes the UI consistently
- Security scan autofix no longer breaks host access or E2E runtime env state after applying fixes
- Mission Control builds now isolate build-time SQLite state from runtime SQLite state, eliminating `SQLITE_BUSY` build contention
- Standalone deploy/runtime handling now preserves data directories, static assets, and restart detection more reliably
- OpenClaw config compatibility issues around malformed `model.primary` payloads, stale keys, and doctor warning classification
- Local Hermes transcript loading, gateway chat/channel RPC fallbacks, and memory panel regressions from the refactor cycle
- E2E harness isolation so tests use fresh temp OpenClaw state, temp skill roots, and deterministic scheduler behavior
- Login/autofill/CSP regressions, websocket/device-identity edge cases, memory graph fit/overflow issues, and several panel parity gaps found during the refactor

### Changed
- Project version advanced to `2.0.0`
- Node runtime policy standardized on `22.x` across local development, CI, Docker, and standalone deployment
- README, landing-page handoff, and release documentation refreshed to match the current Mission Control interface and feature set
- This release captures 189 commits on top of `main` and marks the major refactor branch as the new baseline for Mission Control
- Navigation, loading, branding, and onboarding flows were redesigned to match the broader v2 operator experience

### Contributors
- @0xNyk

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
