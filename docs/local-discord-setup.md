# Local Discord-Only Setup

This guide configures Mission Control for a local OpenClaw gateway with Discord as the active transport.

## Prerequisites

- macOS/Linux shell with `bash`
- `node`, `pnpm`, `openclaw`, `jq`, `curl` in `PATH`
- OpenClaw gateway running (`openclaw gateway status --json`)
- Discord channel configured and running (`openclaw channels status --json`)

## Setup

From the Mission Control repository root:

```bash
bash scripts/setup-local-discord.sh
```

What it does:

- Validates required commands and current OpenClaw gateway/Discord health
- Creates/updates `.env.local` idempotently with local gateway values
- Ensures `MC_ALLOWED_HOSTS` includes `localhost,127.0.0.1`
- Sets `API_KEY` if missing/placeholder
- Runs `pnpm install` and `pnpm build`

## Validation

After Mission Control is running on port `3005`, execute:

```bash
bash scripts/validate-local-discord.sh
```

Validation checks:

- `openclaw gateway status --json` reports running + RPC healthy
- `openclaw channels status --json` reports Discord configured/running
- Fails if Telegram is configured/running
- Authenticated API probes to:
  - `GET /api/status?action=gateway`
  - `GET /api/status?action=overview`

Expected success output includes:

- `[validate-local-discord] result: PASS`

## Troubleshooting

- Gateway not healthy:
  - `openclaw gateway status --json`
  - `openclaw gateway restart`
- Discord not running:
  - `openclaw channels status --json`
  - verify Discord bot token/config in OpenClaw config
- API auth failures:
  - check `.env.local` contains a non-placeholder `API_KEY`
  - ensure Mission Control process uses the same `.env.local`
- Port conflict on `3005`:
  - `lsof -nP -iTCP:3005 -sTCP:LISTEN`
