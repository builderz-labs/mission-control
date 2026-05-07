# OpenClaw Telegram Onboarding (env-driven DM policy)

If your bot token is set but Mission Control/OpenClaw still shows:

`Telegram DMs: locked (channels.telegram.dmPolicy="pairing")`

that is **expected**. `pairing` is the secure default and is informational, not a failure.

## `.env` / `.env.openclaw` keys

```env
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_NUMERIC_USER_ID=<your-numeric-telegram-id>
TELEGRAM_DM_POLICY=pairing
# optional csv numeric ids
TELEGRAM_ALLOW_FROM=
# optional csv values: telegram:<id> or numeric id
TELEGRAM_OWNER_ALLOW_FROM=
```

`TELEGRAM_DM_POLICY` behavior:

- `pairing` (secure default): unknown DM users must be approved via pairing flow.
- `allowlist`: only IDs in `channels.telegram.allowFrom` can DM.
- `open`: no DM sender restriction.

Legacy compatibility is preserved:

- `TELEGRAM_NUMERIC_USER_ID` is still supported.
- Its numeric id is merged into:
  - `commands.ownerAllowFrom += ["telegram:<id>"]`
  - `channels.telegram.allowFrom += ["<id>"]`
- If no explicit `TELEGRAM_DM_POLICY` is set and `TELEGRAM_NUMERIC_USER_ID` exists, bootstrap keeps legacy `allowlist` behavior.

## 1) Find your Telegram user ID

1. Open Telegram and send any message to your bot (for example `/start`).
2. Query the bot updates endpoint:

```bash
curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates"
```

3. Read your numeric ID from `message.from.id`.

## 2) Approve your DM pairing identity (required when `TELEGRAM_DM_POLICY=pairing`)

List pending pairings:

```bash
docker compose -f docker-compose-openclaw.yml run --rm openclaw-cli pairing list
```

Approve your Telegram user ID:

```bash
docker compose -f docker-compose-openclaw.yml run --rm openclaw-cli pairing approve <TELEGRAM_USER_ID>
```

## 3) Optional explicit allowlists in `openclaw.json`

Set explicit owner/channel allowlists (replace with your ID):

```json
{
  "commands": {
    "ownerAllowFrom": ["telegram:<TELEGRAM_USER_ID>"]
  },
  "channels": {
    "telegram": {
      "allowFrom": ["<TELEGRAM_USER_ID>"]
    }
  }
}
```

- `commands.ownerAllowFrom` is recommended for owner-level commands.
- `channels.telegram.allowFrom` is optional but recommended for tighter channel ACLs.

## 4) Restart gateway + MC

```bash
make openclaw-restart
make restart mc
```

Then re-run:

```bash
make openclaw-status
```
