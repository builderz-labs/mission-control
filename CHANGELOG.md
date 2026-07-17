# Changelog

All notable changes to Mission Control are documented in this file.

<!-- Maintainer note: add entries under [Unreleased] as PRs merge; bump to a version when releasing. -->

## [Unreleased]

---

## [2.2.0] - 2026-07-17

This release strengthens Mission Control's self-hosted security boundary, adds native workspace isolation foundations, and modernizes the frontend and release toolchain.

### Added
- Opt-in sandbox flags for host CLI dispatch (#766, closes #720): `allowedTools` (validated against an allowlist), `--max-budget-usd` (clamped), and a workspace-scoped `cwd` (escape-protected via `MC_WORKSPACE_ROOT`). Sourced from `agents.config` with per-task `tasks.metadata` override; absent config leaves dispatch byte-identical to before.
- Native `brand` and `isolation` fields on workspaces (#767, refs #677): migration `052`, isolation enum `shared | strict` enforced in validation, editable from the super-admin panel. (The workspace approval-rules engine from #677 remains deferred.)
- Strict workspace enforcement across routes, background dispatch, schedulers, events, audit records, agent identity, gateway registries, filesystem access, and host administration (#804 through #823).
- Standalone artifact-boundary verification and immutable GitHub Actions pin checks in the protected quality gate (#783, #788).

### Changed
- Migrated to Tailwind CSS v4 (#768): config converted to CSS `@theme`, `@tailwindcss/postcss`, `@custom-variant dark`. Visual QA verified across login, dashboard, task board, onboarding, and all 11 themes including the light Paper theme.
- Hardened privileged runtime setup, identity, gateway, release-update, OS-user, PTY, skill, backup, and maintenance mutations with strict schemas, critical throttling, bounded output, trusted attribution, and safer audit records (#784, #790 through #799, #828 through #835).
- Hardened OSS contribution intake with structured issue forms, clearer contributor provenance expectations, and focused PR risk/evidence requirements (#803, #814, #816, #824).
- Hardened CLI, TUI, MCP, installer, gateway, and operator boundaries against unsafe destinations, path escapes, unbounded remote input, malformed configuration, and executable environment-file semantics (#866 through #884, #886 through #889).

### Fixed
- Model catalog: `costPer1k` renamed to `costPerMTok` (the field held per-million values), `classifyDirectModel` now derives from the catalog instead of a parallel hard-coded list, and all prices re-verified against provider docs (#769, supersedes #751). Fixed two real billing-estimate undercounts: Kimi K2.5 and MiniMax M2.1 output rates.
- Preserved gateway configuration integrity and unified privileged setup/control client error handling (#825 through #831).
- Removed plaintext device-key fallback and tightened execution approval, webhook delivery, CI publishing, backup automation, and standalone release behavior (#782, #789, #791 through #793).
- Restored websocket reconnection after transient disconnects (#832).
- Aligned authentication diagnostics and security reports with encoded-password deployments (#887).
- Restored the Docker release build context for the non-executable environment loader (#889).

### Security
- Workspace isolation now fails closed for ambiguous or unowned resources instead of silently falling back to deployment-wide access.
- Sensitive host mutations use scoped critical rate limits, strict allowlists, bounded/redacted responses, and audit-safe identifiers.
- Workflow actions are pinned to reviewed commit SHAs; standalone builds are checked for runtime-data and secret-boundary violations.
- Added descriptor-based filesystem operations, atomic configuration/workspace writes, randomized build scratch paths, stronger path confinement, and resource bounds across trust boundaries (#868 through #871, #874, #881).
- Added HTML sanitization, cryptographic event identifiers, adapter-key isolation, workspace-scoped MCP receipts, and nested configuration assignment guards (#872, #875, #876, #879, #883).
- Added property-based fuzzing with thousands of adversarial path and configuration cases per run (#873, #885).
- Replaced deployment shell sourcing with a strict environment-file data parser and regression-tested the security audit command itself (#886, #888).
- Dependency audit reports no known high-severity vulnerabilities at release preparation time.

### Upgrade notes
- Run database migrations before enabling strict workspace isolation in an existing multi-workspace deployment.
- Review `MC_WORKSPACE_ROOT`, trusted proxy settings, gateway credentials, and host-runtime permissions after upgrading.
- Tailwind CSS v4 replaces the previous JavaScript configuration; downstream custom themes should migrate extensions to CSS theme tokens.
- No approval policy engine is included in this release; workspace classification and isolation metadata do not grant execution authority.

---

## [2.1.0] - 2026-07-04

Three months of merged work promoted to a release, plus a security-audit sprint.

### Security
- **Global API key hashed at rest** (#757) — the dashboard-rotated admin key was stored plaintext in SQLite; now only a sha256 hash is stored and the plaintext is shown exactly once at rotation. A DB read or backup dump no longer yields a live admin credential. Migration `051` converts existing deployments automatically.
- **Dependency tree refreshed: 52 production vulnerabilities → 0** (#756) — including the Next.js middleware/proxy-bypass advisories (critical for this app: all auth is middleware-enforced), ws DoS, and critical shell-quote.
- Gateway bearer token no longer exposed to viewer-role callers (#747, thanks @LHMisme420) and can no longer be overwritten via config update (`gateway.auth.token` write-guard, #755).
- Prompt-injection guard detects homoglyph, zero-width, ROT13/URL/base64 bypasses; device key moved to non-extractable IndexedDB (#657).
- Internal business documents removed from the public tree (#752).

### Added
- Direct multi-provider dispatch: Anthropic API, OpenAI, and local OpenAI-compatible endpoints (Ollama/LM Studio/LiteLLM) without an OpenClaw gateway (#648).
- Host CLI dispatch: run tasks through your own `claude` login — no API key — with Claude CLI detection outside Docker, and new Codex CLI dispatch (#738, thanks @snifram).
- Chat session continuity with the host Claude CLI + CSP nonce hydration fixes (#647).
- Docker: `NEXT_PUBLIC_*` exposed as build args (#643).
- Self-hosted star-history charts (light/dark) refreshed weekly, replacing the third-party embed.

### Fixed
- API proxy rejected dashboard-rotated `mc_` API keys at the edge before route auth could validate them (#753, closes #733).
- Task-board @mention menu: arrow-key highlight no longer snaps back to the top on every keypress (#754, closes #661).
- Legacy agent fallback config was written back to OpenClaw with an incompatible `fallbacks` field (#750, thanks @Obrais-cloud).
- Recurring tasks: sub-daily crons include HH:MM in child titles (#659); openclaw-doctor single-flight + 30s TTL cache stops CPU/RAM spikes (#658).
- Open issue/PR backlog: security audits, fixes, and apiFetch migration (#723).

### Changed
- Dependabot policy: js-deps group restricted to minor+patch (majors arrive individually), GitHub Actions bumps grouped, docker base image tracks the Node LTS line (#755).
- Screenshot-drift workflow no longer fails on fork PRs (#755).
- Model pricing updates: Groq (#736, thanks @oskarkocol) and Anthropic (#644).

---

## [2.0.1] - 2026-03-18

Mission Control 2.0.1 is the first patch release after the v2 launch. It rolls up the full set of fixes and follow-on features that landed after `v2.0.0`, including HTTP/Tailscale login hardening, zero-config onboarding, internationalization, gateway/runtime stability fixes, deeper task-routing automation, and the latest OpenClaw compatibility updates.

### Added
- First-time setup wizard and zero-config startup flow for fresh installs
- Full i18n coverage across the application with 10 language packs and panel-level translations
- Trusted reverse proxy and header-auth support for more flexible self-hosted deployments
- Gateway health history logging and timeline visibility
- Port-based Tailscale Serve proxy detection and stronger public websocket URL handling
- Task implementation-target persistence, session targeting, and complexity-based model-tier routing
- GNAP sync for git-native task persistence
- Hybrid dashboard mode for simultaneous gateway and local session visibility
- Workspace skill root discovery, filtering, and per-agent skill-root display
- Windows PowerShell installer support
- `awaiting_owner` task status detection

### Changed
- Node runtime policy now accepts all versions `>=22` instead of a narrow allowlist
- CSP and browser-security helpers were factored into dedicated modules for clearer hardening boundaries
- Docker/image release automation now supports the official Docker Hub image when repository secrets are configured
- Release metadata and docs now point to the Builderz Labs repository as the canonical source

### Fixed
- HTTP and Tailscale login regressions caused by unconditional HTTPS redirects and CSP nonce propagation gaps
- Fresh HTTP Docker installs failing login because secure-cookie behavior did not follow the actual request protocol
- Gateway auth and credential detection for mixed token/password setups
- Task dispatch using display names instead of gateway agent IDs
- Docker and gateway-optional regressions across Compose startup, health probes, public assets, `OPENCLAW_HOME`, and read-only config handling
- SQLite `SQLITE_BUSY` contention by adding `busy_timeout` and guarding build-phase eager initialization
- Doctor banner dismissal persistence, cron panel crash handling, and null-safe model config editing
- Gateway connectivity and onboarding probe issues, including POST-based wizard health checks and explicit public websocket URL preference
- Notification refresh timing, agent empty-state UX, duplicate task-title/delete handling, and several panel/runtime regressions
- Memory diagnostics scoping, gateway notification delivery, session labels, and multiple i18n namespace gaps
- Password generation now uses a CSPRNG in the Windows installer
- Reagraph CSP rendering regression caused by nonce handling in `style-src`
- `/api/spawn` now supports OpenClaw agents that rely on configured default models instead of requiring a runtime `model`
- Gateway dashboard registration now has explicit regression coverage preserving device-auth posture

### Security
- Removed `unsafe-inline` in favor of nonce-based CSP handling
- Strengthened skill-registry SSRF and path-traversal detection rules
- Stopped forcing `dangerouslyDisableDeviceAuth` during Mission Control gateway registration

### Tests
- Coverage for pure utility modules to keep the Vitest threshold passing in CI
- Gateway health history E2E and supporting utility tests
- Docker-mode integration coverage for gateway connectivity regressions
- Regression coverage for spawn-schema compatibility and gateway dashboard registration behavior

### Contributors
- @0xNyk
- @Brixyy
- @clintbaxley
- @dk-blackfuel
- @firefloc-nox
- @HonzysClawdbot
- @hectorse.88
- @jonathan-squaredlemons
- @jonboirama
- @joshua-mo-143
- @jrrcdev
- @lucascr
- @RazorFin
- @topshelfmedia

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
