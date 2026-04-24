# Captain Hook — ICT Trading Discord Bot

Discord bot for the Wealth Building with ICT group. Provides ICT trading assistance, live data, and chart analysis.

## Capabilities

- **Natural conversation** — responds to questions in #ict-bot-alerts and #general
- **Chart image analysis** — auto-analyzes trading chart screenshots
- **YouTube transcript analysis** — extracts and analyzes video transcripts
- **Slash commands** — /ask, /stats, /signal, /glossary, /propose, /research, /health
- **Proposal system** — group members propose changes, routed to Ross for approval
- **Reaction tracking** — tracks group engagement on alerts

## Setup

```bash
pip install -r requirements.txt
DISCORD_BOT_TOKEN=xxx python bot.py
```

## Architecture

Currently a single `bot.py` file (~800 lines). Planned split into:
- `bot.py` — entry point, event handlers (~100 lines)
- `commands/` — one file per slash command
- `listeners.py` — message listener, image handler, YouTube handler
- `cli_client.py` — LLM calls via claude -p or engine HTTP API

## Environment Variables

- `DISCORD_BOT_TOKEN` — Captain Hook bot token
- `TRADING_DB_PATH` — path to trading.db
- `BRAVE_API_KEY` — for /research command
- `TELEGRAM_BOT_TOKEN` — for proposal routing to Ross
- `TELEGRAM_ROSS_ID` — Ross's Telegram user ID

## Channels

- `#ict-bot-alerts` (1485750310160040036) — primary bot channel
- `#general` (1071958694134288477) — also monitored
