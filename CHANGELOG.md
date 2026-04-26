# Changelog — Killzone ICT Scanner

All notable changes to this project. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioned per [SemVer](https://semver.org/): PATCH for fixes and small improvements, MINOR for new features, MAJOR for breaking architectural changes.

<!-- Add entries under [Unreleased] as changes land; bump to a version on deploy. -->

## [Unreleased]

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
