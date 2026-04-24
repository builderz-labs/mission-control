# RoceOS Architecture Blueprint — v1.0

**Date:** 2026-04-24
**Status:** Approved — all future development follows this structure
**Author:** Architecture agent, reviewed by Ross Hickey

---

## Overview

RoceOS is a personal AI operating system with 11 skillsets, 12+ integrations, and multiple external interfaces (Telegram, Discord, Dashboard). This document defines the target architecture after refactoring from the current scattered state.

**Principle:** The code must be readable by a non-developer (Ross is a cybersecurity professional). Clear naming, one file per concern, documented interfaces.

---

## Directory Structure

```
roce-os/
│
├── docker-compose.roceos.yml     # Full stack deployment
├── .env.example                  # Credential documentation (no real values)
├── .env                          # Actual secrets — GITIGNORED
├── Makefile                      # make deploy, make logs, make test, make status
│
├── engine/                       # The AI brain
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                   # FastAPI entrypoint
│   ├── config.py                 # Settings (reads from env vars)
│   │
│   ├── core/                     # Infrastructure
│   │   ├── router.py             # PA Router — classifies which skillset handles a message
│   │   ├── cross_team.py         # Multi-skillset query synthesis
│   │   ├── graph_builder.py      # LangGraph graph factory
│   │   ├── telegram.py           # Telegram bot interface
│   │   └── llm.py                # Central model factory (cli vs api mode)
│   │
│   ├── skillsets/                 # 11 AI domains — one file each
│   │   ├── __init__.py           # Registry
│   │   ├── base.py               # SkillsetConfig dataclass
│   │   ├── general.py            # through recreation.py (11 total)
│   │   └── ...
│   │
│   ├── tools/                    # Capabilities skillsets can call — grouped by domain
│   │   ├── __init__.py           # Exports all tool collections
│   │   ├── memory.py             # remember_fact, recall_facts
│   │   ├── web.py                # http_get, brave_search
│   │   ├── shell.py              # run_ssh_command
│   │   ├── google.py             # Calendar, Gmail, Drive
│   │   ├── obsidian.py           # Wiki/vault reads
│   │   ├── trading.py            # Alpaca positions, account info
│   │   ├── github.py             # Repo info, commits
│   │   ├── unifi.py              # Network tools
│   │   └── store.py              # Persistent knowledge store
│   │
│   ├── scheduler/                # Phase 6 scheduled jobs
│   │   ├── core.py               # APScheduler wrapper
│   │   ├── notification.py       # Telegram notification routing
│   │   ├── jobs.py               # All scheduled job definitions
│   │   ├── briefing.py           # Morning briefing aggregation
│   │   └── calendar_watch.py     # Calendar-triggered actions
│   │
│   └── tests/
│       ├── test_router.py
│       ├── test_skillsets.py
│       └── test_tools.py
│
├── bots/                         # External-facing interfaces
│   └── discord/                  # Captain Hook
│       ├── Dockerfile
│       ├── requirements.txt
│       ├── bot.py                # Entry point (~100 lines)
│       ├── commands/             # One file per slash command
│       │   ├── ask.py
│       │   ├── stats.py
│       │   ├── signal.py
│       │   ├── propose.py
│       │   ├── research.py
│       │   ├── health.py
│       │   └── glossary.py
│       ├── listeners.py          # Message listener + image/YouTube handlers
│       ├── cli_client.py         # Calls engine via claude -p or HTTP
│       └── README.md
│
├── trading/                      # Trading system
│   ├── scanners/
│   │   ├── ict_scanner.py        # ICT 5-condition scanner
│   │   ├── conditions.py         # Individual condition detection functions
│   │   └── symbols.py            # ES/NQ instrument config
│   ├── stocks/
│   │   ├── rsi_bot.py
│   │   └── orb_bot.py
│   ├── shared/
│   │   ├── alpaca_client.py      # Alpaca API wrapper
│   │   ├── notify.py             # Telegram/Discord alert helper
│   │   └── db.py                 # SQLite trading log
│   ├── cron.sh                   # Cron wrapper script
│   ├── requirements.txt
│   └── README.md
│
├── dashboard/                    # Trading dashboard
│   ├── backend/
│   │   ├── Dockerfile
│   │   ├── main.py               # FastAPI — thin API layer
│   │   └── requirements.txt
│   ├── frontend/                 # Next.js + shadcn/ui
│   │   └── ...
│   └── README.md
│
├── config/                       # Static configuration files
│   └── litellm.yaml              # Model proxy config (standby mode)
│
├── data/                         # Runtime data — GITIGNORED
│   ├── trading.db
│   ├── knowledge.db
│   ├── google_token.json
│   └── scheduler.db
│
├── scripts/
│   ├── deploy.sh                 # Pull + rebuild + restart
│   ├── backup.sh                 # Backup data/
│   └── health_check.sh           # Verify all services
│
├── agents/                       # Markdown agent definitions (existing)
├── docs/
│   ├── ARCHITECTURE-V1.md        # THIS DOCUMENT
│   ├── ADDING-A-CAPABILITY.md    # Step-by-step guide
│   ├── DEPLOYMENT.md             # VPS setup
│   └── SECURITY.md               # Credential management
│
├── CHANGELOG.md
└── README.md
```

---

## Four Module Patterns

### Pattern 1: Skillset (AI conversation domain)
A Python file in `engine/skillsets/`. Register a `SkillsetConfig` with id, name, description, model tier, and system prompt. The router uses the description to classify incoming messages.

Adding a skillset = 1 new file + 1 import in main.py + 1 tool assignment in graph_builder.py.

### Pattern 2: Tool (capability a skillset can call)
A `@tool`-decorated async function in `engine/tools/`. Returns a string. Handles its own auth via settings.

Adding a tool = 1 new file + 1 import in tools/__init__.py + 1 line in graph_builder.py's SKILLSET_TOOLS.

### Pattern 3: External Bot (non-AI interface)
A self-contained service in `bots/` that calls the engine via HTTP or cli_client.py. Does NOT import engine code. Has its own Dockerfile.

### Pattern 4: Trading Script (scheduled task)
Standalone Python in `trading/`. Imports from `trading/shared/` only. Invoked by cron. Sends alerts via `trading/shared/notify.py`.

---

## Config System

**ONE `.env` file at repo root. Nothing else.**

Every service reads from environment variables. Docker Compose passes `env_file: - .env` to all services. Host cron scripts source `.env` before calling Python.

Key variables:
- `LLM_MODE=cli` — "cli" for Max subscription ($0), "api" for Anthropic API (costs $)
- `ANTHROPIC_API_KEY` — only used when LLM_MODE=api
- All Telegram/Discord/Alpaca/Google/etc. credentials in this one file

---

## Communication

- **Within engine:** Direct Python imports. Skillsets call tools.
- **Engine ↔ Bots:** HTTP API (`POST /chat`) or cli_client.py
- **Trading ↔ Notifications:** Direct Telegram Bot API (independent of engine)
- **Cross-team queries:** core/cross_team.py fans out to multiple skillsets

---

## Security Model

- Credentials in ONE .env file, never in code, never in git
- Per-service credential scoping (least privilege) in docker-compose
- All SSH commands audit-logged to data/audit.log
- Discord approval gate: code changes require Ross's Telegram approval
- Secret rotation: update .env → restart service → done (no code changes)

---

## Adding a New Capability (Example: WhisperX STT)

1. Create `engine/tools/whisper.py` — one `@tool` function (~50 lines)
2. Add `from tools.whisper import WHISPER_TOOLS` to `engine/tools/__init__.py`
3. Add `"general": ... + WHISPER_TOOLS` in `engine/core/graph_builder.py`
4. Add `whisperx` to `engine/requirements.txt`
5. Update relevant skillset system prompts to mention the capability
6. `git commit -m "feat: add WhisperX transcription tool"` → `make deploy`

Five files, zero new infrastructure, zero new services.

---

## Migration Plan

| Phase | What | Effort | Downtime |
|-------|------|--------|----------|
| 1 | Reorganize engine dirs (tools/, core/) | 2-3h | Zero |
| 2 | Fix LLM mode (cli vs api abstraction) | 1-2h | Zero |
| 3 | Integrate trading scripts | 2-3h | Zero |
| 4 | Integrate Discord bot | 2-3h | Zero |
| 5 | Consolidate credentials | 1h | Brief restart |
| 6 | Decommission VPS orphans | 30m | Zero |

**Total: ~12-15 hours across 3-4 sessions.**

**Rule:** Back up `data/` before every phase. The data directory is the most important thing not to lose.

---

## Git Workflow

- `main` = production (what runs on VPS)
- `feature/NAME` = all development
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`
- Semantic versioning in CHANGELOG.md

---

*This architecture blueprint governs all future RoceOS development. No new capabilities are added without following these patterns.*
