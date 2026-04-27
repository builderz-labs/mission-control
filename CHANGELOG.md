# Changelog — Killzone ICT Scanner

All notable changes to this project. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioned per [SemVer](https://semver.org/): PATCH for fixes and small improvements, MINOR for new features, MAJOR for breaking architectural changes.

<!-- Add entries under [Unreleased] as changes land; bump to a version on deploy. -->

## [Unreleased]

---

## [3.16.0] - 2026-04-27

### Added
- **Financial disclaimers** on all trading-facing surfaces (closes #24)
  - Dashboard footer (sitewide, every page): "For educational purposes only. Not financial advice. Trading futures involves substantial risk of loss and may not be suitable for all investors. Past performance is not indicative of future results."
  - Discord signal alerts: disclaimer prepended to embed footer on every alert posted by the scanner

---

## [3.15.0] - 2026-04-27

### Added
- **Entitlements enforcement at runtime** — subscription rules now enforced server-side, not just sent as hints to the agent (closes #35)
  - `expires_at` checked on every `get_entitlement()` call — expired users get `live_enabled=False` and `max_per_day=0` automatically
  - `max_per_day` enforced in `ConnectionManager.broadcast()` via in-memory daily counter (resets at UTC midnight) — expired or over-limit users skip signal delivery
  - `live_enabled` enforced server-side on trade result reports — live execution reports rejected if user is not entitled, preventing an agent-side bypass
- **Admin entitlements API** — `GET/PATCH /api/entitlements` and `GET/PATCH /api/entitlements/{user_id}` (admin only); live-pushes updated entitlement to connected agent immediately without requiring reconnect (closes #39)
- **Trial expiry enforcement** — subscriptions with `expires_at` set are now automatically downgraded when the date passes (closes #36)

---

## [3.14.0] - 2026-04-27

### Security
- **Login brute-force protection** — 5 failed attempts per IP per 15 min returns 429; in-memory sliding window, no dependency required (closes #17)
- **Timing attack prevention** — unknown usernames now run full scrypt comparison, preventing username enumeration via response time
- **Login audit logging** — all failed and successful logins logged with IP and username
- **Security response headers** — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` on every response (closes #20)
- **CORS tightened** — explicit method list (`GET POST PATCH DELETE OPTIONS`) and explicit header list instead of `allow_methods=["*"]` / `allow_headers=["*"]`
- **`/ws/prices` authenticated** — WebSocket closes with code 4401 if no valid session cookie; previously open to any client

### Fixed
- `router.py` now falls back to `TELEGRAM_TOKEN` env var if `TELEGRAM_BOT_TOKEN` is not set — live fill alerts would have silently dropped
- All `from data.db import` references replaced with `from shared.db import` — `data/db.py` was an untracked ghost file that would vanish on fresh clone, breaking the scanner and router

---

## [3.13.0] - 2026-04-26

### Added
- **Discord OAuth login** — "Sign in with Discord" is now the primary auth method on the login page
  - `/api/auth/discord` redirects to Discord authorization
  - `/api/auth/discord/callback` handles code exchange, upserts user row, sets session cookie, redirects to dashboard
  - `discord_id`, `discord_username`, `discord_avatar`, `auth_method` columns added to `users` table via idempotent startup migration
  - `DISCORD_ADMIN_IDS` env var (comma-separated Discord user IDs) → admin role
  - `DISCORD_GUILD_ID` env var (optional) restricts login to members of a specific Discord server
  - NavAuth shows Discord avatar thumbnail + display name for OAuth users
  - Password login preserved as admin fallback

### Setup required on VPS
- Add `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_ADMIN_IDS` to `/opt/ict-dashboard-backend/.env`
- Set redirect URI `https://api.ictwealthbuilding.com/api/auth/discord/callback` in Discord Developer Portal → OAuth2

---

## [3.12.0] - 2026-04-26

### Added
- **PyInstaller spec** (`trading/agent/ict_agent.spec`) — builds `ICT-Agent.exe` as a single-file Windows binary; includes all keyring backends and websockets internals
- **Inno Setup script** (`trading/agent/installer/ict-agent-setup.iss`) — wraps `ICT-Agent.exe` in a proper Windows installer; installs to `%LOCALAPPDATA%\ICTAgent`, Start Menu shortcut, offers setup wizard on first run, no elevation required
- **GitHub Actions build workflow** (`.github/workflows/build-agent.yml`) — triggers on `agent-v*` tag push; builds on `windows-latest`, runs PyInstaller + Inno Setup, computes SHA-256 checksums, creates GitHub pre-release with both binaries attached
- `GET /agent/latest` — proxies GitHub releases API; returns current version, download URLs, and changelog snippet so the agent can check for updates on startup
- `trading/agent/README.md` — 2-page user quickstart: prerequisites, Windows install, setup wizard walkthrough, pause/resume, risk settings, FAQ

### Deploy
- Tag `agent-v1.1.0` to trigger first build: `git tag agent-v1.1.0 && git push origin agent-v1.1.0`

---

## [3.11.0] - 2026-04-26

### Added
- **Users page** (`/users`) — admin UI to manage agent accounts without SSH
  - Table shows all users with ONLINE/OFFLINE/REVOKED status badges, last seen (CDT), hostname, agent version, tier, and live-mode indicator
  - "Invite User" button opens a modal — enter user ID + display name, generates one-time 48h pairing token with one-click copy
  - Per-row "New Token" button regenerates a pairing token (invalidates any unconsumed previous tokens)
  - Per-row "Revoke" button with confirmation step; sends `force_disconnect` to agent if currently connected
- `GET /api/users` — list all agents with live connection status + entitlement summary
- `POST /api/users` — create user + return pairing token (admin only)
- `POST /api/users/{user_id}/regenerate` — new pairing token, old unconsumed tokens invalidated
- `DELETE /api/users/{user_id}` — revoke access + push force_disconnect to live session
- `PATCH /api/users/{user_id}/entitlement` — update tier/caps live; pushes updated entitlement to connected agent immediately
- `GET /api/users/{user_id}/trades` — trade history for a specific user (admin only)
- Users nav link added to dashboard header

---

## [3.10.0] - 2026-04-26

### Added
- **User entitlements system** — per-user server-enforced trading caps pushed to each agent on WebSocket connect: `tier`, `max_contracts`, `max_per_day`, `allowed_symbols`, `allowed_timeframes`, `live_enabled`
- `entitlements`, `audit_log`, and `agent_metrics` tables in `trading.db`; all seeded automatically on first agent pair/connect
- Entitlement-aware broadcast — `ConnectionManager.broadcast()` now filters signals per-user by `allowed_symbols` and `allowed_timeframes`; non-signal messages (ping, global_halt) still reach everyone
- Server pushes `{"type":"entitlement", ...}` immediately on WebSocket connect before first signal so agent applies correct limits
- **Audit log** — every agent action (connect, disconnect, trade_result, entitlement_violation) logged to `audit_log` table; required for trade disputes
- **Per-agent metrics** — `agent_metrics` table tracks connects, disconnects, trades_attempted per user
- `POST /api/agents/{user_id}/halt` — push `user_halt` message to one specific connected agent (admin only)
- `POST /api/agents/halt_all` — push `global_halt` to all connected agents (admin only)
- **Agent v1.1.0** — complete security + reliability overhaul of `trading/agent/signal_agent.py`
  - Keyring-mandatory: hard `sys.exit(1)` if keyring unavailable; JWT stored in keyring, not config file
  - Demo-first default: agent starts in DEMO mode; server `live_enabled` flag switches it
  - Signal dedup: persists last 100 executed `signal_id` values to `~/.ict-agent/state.json` — survives restarts
  - Pause flag: `~/.ict-agent/PAUSED` file holds agent without killing process
  - `effective_qty = min(local_config.qty, server_entitlement.max_contracts)` — server ceiling cannot be bypassed
  - Handles `global_halt`, `user_halt`, `force_disconnect` server messages
  - Close codes 4001/4003 exit immediately without reconnect
- `trading/agent/requirements.txt` — pinned deps for standalone agent install (`httpx>=0.25, websockets>=12, keyring>=24`)

### Changed
- `_handle_trade_result()` validates `reported_qty <= max_contracts` before logging; logs `entitlement_violation` to audit if exceeded
- `ConnectionManager.connect()` now accepts and stores entitlement dict; `disconnect()` cleans it up
- Pairing endpoint (`POST /api/pair`) now calls `seed_entitlement()` and `log_audit()` on every successful pair

---

## [3.9.0] - 2026-04-26

### Added
- **Kill switch** — `/halt` and `/resume` Discord slash commands (admin only) write/remove `/tmp/execution_halt`; live router checks flag before any order placement
- `POST /api/execution/halt` and `POST /api/execution/resume` dashboard endpoints (admin session required); `GET /api/execution/status` returns current halt state
- **Telegram alert on every live fill** — `_send_telegram()` in `router.py` fires immediately after a bracket order is placed; message includes symbol, direction, contract, entry/stop/target, order ID, and trade ID
- **API error Telegram alert** — any exception in the live execution path pages Ross immediately via Telegram (router.py except block)
- **Duplicate live signal guard** — live route checks `paper_trades` for an existing live trade on the same symbol/TF/direction within the last 5 minutes; skips if found
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` env vars consumed by router (TELEGRAM_CHAT_ID defaults to 8787239235)

### Notes
- All 4 items above are P0 live readiness blockers (roadmap: `live_readiness` track). Must be deployed and verified before first live trade.
- Kill switch state is shared by path — bot.py and dashboard both write `/tmp/execution_halt`; router reads it.

---

## [3.8.0] - 2026-04-26

### Added
- Dashboard P1 — session auth replacing X-Admin-Token
- `POST /api/auth/login` — scrypt password verify, HttpOnly session cookie (30-day TTL)
- `POST /api/auth/logout` — clear session cookie + delete server-side session
- `GET /api/auth/me` — return current session user (null if not logged in)
- `GET|PATCH /api/settings` — user settings read/write (admin only)
- `users`, `sessions`, `user_settings` tables in `dashboard.db`; admin user auto-seeded from `KILLZONE_ADMIN_USER` + `KILLZONE_ADMIN_PASS` env vars on first start
- `/login` page — username/password form, redirects to dashboard on success
- `Sign in / Sign out` button in nav header; shows username when logged in
- Role-based roadmap — `system: roceos` tracks hidden from unauthenticated viewers

### Changed
- `POST /api/proposals/{id}/decide` now requires session cookie (admin role); X-Admin-Token removed from this route
- `POST /api/proposals/{id}/assess` keeps X-Admin-Token for bot backward compatibility
- CORS changed from `*` to explicit allowed origins (required for `credentials: include`)
- `ProposalCard` — approve/reject/revise buttons only visible when logged in as admin
- Removed `AdminTokenPrompt` component and localStorage token storage

---

## [3.7.8] - 2026-04-26

### Fixed
- Contract rollover: `get_front_month_symbol()` now uses CME expiry date (3rd Friday of contract month) minus 8 calendar days as the roll cutover — was using `now.month <= m` which would have served the wrong contract after the roll date
- Next roll deadline: Jun 11 2026 (MESM6 → MESU6); Sep 10 2026 (MESU6 → MESZ6)
- Applied to both `execution/tradovate.py` and `agent/signal_agent.py`

---

## [3.7.7] - 2026-04-26

### Added
- `bias_alignment` column in `paper_trades` — records HTF alignment count (0-3) at the time of trade entry (Proposal #1 data collection phase)
- `db_log_paper_trade()` in both scanners now captures `sig["bias"]["aligned"]` and persists it; gates on sizing automation deferred pending validation

---

## [3.7.6] - 2026-04-26

### Changed
- `/glossary` updated with PDA, CBDR, ORG, SMT — terms added to the scanner since the glossary was first written
- Removed "Proposal by Shift" attribution from glossary footer

---

## [3.7.5] - 2026-04-26

### Added
- YM=F (Dow Jones) added to instruments as `observe_only` — scanned every pass, logged to DB, never alerts or executes (Proposal #10 Phase A)
- `smt_divergence` table in trading DB — records ES/NQ/YM signals + directions + diverge flag after every scan
- `log_smt_divergence()` in shared/db.py — diverge=1 when YM breaks from ES+NQ consensus

---

## [3.7.4] - 2026-04-26

### Changed
- Captain Hook system prompt now pulls live win-rate and P&L from the trading database on startup, refreshing every hour — no more stale hardcoded stats

---

## [3.7.3] - 2026-04-26

### Changed
- Removed "Gameplan-007" attribution from all user-facing surfaces: dashboard meta description, footer, Discord alert footers, bot system prompts, and module docstrings — system is now referred to simply as "ICT Scanner"

---

## [3.7.2] - 2026-04-26

### Changed
- Daily timeframe MSS detection now uses 5-candle swing fractals (n=2) instead of 3-candle — ICT multi-bar structure requirement for daily bias confirmation
- Intraday (15m, 1h) fractals unchanged at 3-candle (n=1)
- MSS detail string now labels fractal size per timeframe
- Applied to both `ict_scanner.py` and `futures_scanner.py` (cron copy)

---

## [3.7.1] - 2026-04-25

### Added
- PDA (Premium/Discount Array) hard gate — LONGs blocked in premium, SHORTs blocked in discount; 0.1% dead band at equilibrium (Proposal #9)
- PDA zone (DISCOUNT/PREMIUM/EQUILIBRIUM) and equilibrium level shown in every Discord alert under Key Levels
- Trade IDs in dashboard and Discord alerts; timestamps converted UTC→ET throughout (Proposal #8)

### Changed
- Split equity curve into three tabs: combined dollars, ES points, NQ points (Proposal #6)
- Dollar P&L now uses correct micro contract point values: MES $5/pt, MNQ $2/pt (was incorrectly using full E-mini values)

### Fixed
- Recharts formatter TypeScript type error (ValueType | undefined)
- Scanner page timestamps now display in ET

---

## [3.7.0] - 2026-04-24

### Added
- Signal broadcast system (Architecture A) — WebSocket endpoint + JWT auth + one-time pairing tokens
- Execution router — routes signals to paper logging, live broker, and multi-user WebSocket broadcast
- Tradovate REST client — auth, bracket orders (OSO), front-month contract resolver (ES=F → MESM6)
- Position cap: max 1 open trade per TF per instrument, max 2 per instrument total
- Daily loss halt: 3 losses on same instrument halts trading for the day
- Captain Hook now responds to @mentions only (removed keyword/? triggers)
- Discord echo-back for proposal decisions — bot posts to #ict-bot-alerts when Ross approves/rejects

### Changed
- All LLM calls migrated to `claude -p` (Max subscription, $0 API cost) — OpenClaw deprecated
- Claude OAuth long-lived token (OAT) as primary auth path for `claude -p`

### Fixed
- VPS health check now uses API endpoint instead of docker CLI (eliminated XML spam)
- RoceOS morning briefing XML leak fixed

---

## [3.6.3] - 2026-04-20

### Added
- `/roadmap` page — YAML-sourced capability tracks with progress bars, phase cards, commit/PR links
- Auto-assess proposals on `/propose` — Claude runs 5-step ICT checklist before recommending APPROVE/REJECT/MODIFY
- `/proposals` page — full proposal queue with status, decisions, and notes

---

## [3.6.1] - 2026-04-17

### Added
- Dashboard frontend pulled into monorepo (`dashboard/web/`)
- System health self-heal script + `/api/health/detailed` endpoint
- Single-source `/VERSION` file — all version strings read from it, no hardcoded values

### Fixed
- RoceOS morning briefing XML leak
- EOD check implementation restored after Phase 3 refactor

---

## [3.6.0] - 2026-04-10

### Added
- 5-condition ICT chain: HTF liquidity sweep, MSS/CHoCH, unmitigated FVG, price at FVG, kill zone
- Hard gates: 1H KZ gate, 15m MSS gate, HTF bias filter, 1:5 R:R minimum, daily KZ exemption
- Reference levels in alerts: PDH/PDL, CBDR, ORG, VIB, BPR, REH/REL, NWOG, macro times, PO3
- TradingView webhook receiver + cron backup scanner
- Paper trade auto-log at 4/5+ conditions; 7-day max hold; WIN/LOSS/VOID resolution
- Captain Hook Discord bot — 7 slash commands, natural conversation, image analysis, YouTube transcript
- Proposal system — /propose, bot.db, Telegram notification to Ross
