# Changelog — Killzone ICT Scanner

All notable changes to this project. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioned per [SemVer](https://semver.org/): PATCH for fixes and small improvements, MINOR for new features, MAJOR for breaking architectural changes.

<!-- Add entries under [Unreleased] as changes land; bump to a version on deploy. -->

## [Unreleased]

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
