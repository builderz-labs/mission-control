# Trading System

ICT futures scanner + stock bots. Runs via cron on the VPS host (not in Docker).

## Structure

```
trading/
├── scanners/
│   ├── ict_scanner.py    — ICT 5-condition chain (ES/NQ futures)
│   └── tv_webhook.py     — TradingView webhook receiver (real-time triggers)
├── stocks/               — RSI(2) + ORB stock bots (future)
├── shared/
│   ├── db.py             — SQLite trading database (signals, paper trades)
│   ├── daily_summary.py  — End of day P&L summary
│   ├── eod_check.py      — End of day position check
│   ├── health_check.py   — Trading system health verification
│   └── sync_to_duckdb.py — Sync SQLite to DuckDB for analytics
├── cron.sh               — Cron wrapper (runs on VPS host)
└── requirements.txt
```

## How It Works

1. TradingView sends bar-close webhooks to `tv_webhook.py` (port 5001)
2. Webhook triggers `ict_scanner.py` for the relevant timeframe
3. Scanner evaluates 5 ICT conditions + hard gates + confluence
4. If 4/5+ conditions pass → ALERT → Discord embed + paper trade logged
5. Paper trades auto-resolve at T1 (WIN) or stop (LOSS)

## Cron Schedule

- `*/15 * * * *` — Futures 15m scanner (backup for webhooks)
- `0 * * * *` — Futures 1H scanner
- `0 18 * * 1-5` — Futures daily scanner
- `0 13,15:20 * * 1-5` — Stock RSI bot
- `46 13 * * 1-5` — Stock ORB bot

## Data

Trading database: `data/trading.db` (SQLite)
Not stored in this repo — lives on the VPS at runtime.
