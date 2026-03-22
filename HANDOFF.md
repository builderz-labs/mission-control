# Mission Control — Handoff

## What It Is

Mission Control is an AI agent orchestration dashboard (Next.js 16, SQLite) connected to your OpenClaw gateway at `127.0.0.1:18789`.

## Access

| Item | Value |
|------|-------|
| URL (local) | http://localhost:3244 |
| URL (LAN — direct) | http://192.168.0.11:3244 or http://marcel.local:3244 |
| Username | `admin` |
| Password | `~/Projects/mission-control/.env` → `AUTH_PASS` |
| API Key | `~/Projects/mission-control/.env` → `API_KEY` |

Never commit `.env`.

## Secrets + Where They Live

`~/Projects/mission-control/.env` must contain:
- `AUTH_USER`
- `AUTH_PASS`
- `AUTH_SECRET`
- `API_KEY`
- `OPENCLAW_GATEWAY_TOKEN`

Integration vars in same file:
- `PORT=3244`
- `HOSTNAME=127.0.0.1`
- `MC_BIND_HOST=127.0.0.1`
- `OPENCLAW_GATEWAY_HOST=127.0.0.1`
- `OPENCLAW_GATEWAY_PORT=18789`
- `MC_ALLOWED_HOSTS=localhost,127.0.0.1,192.168.0.11,marcel,marcel.local`
- `NEXT_PUBLIC_GATEWAY_HOST=127.0.0.1`
- `NEXT_PUBLIC_GATEWAY_PORT=18789`
- `NEXT_PUBLIC_GATEWAY_PROTOCOL=ws`
- `NEXT_PUBLIC_GATEWAY_URL=ws://127.0.0.1:18789`

## Daily Operation

### Status
```bash
launchctl list | grep missioncontrol
# Shows two services: ai.missioncontrol (Next.js) and ai.missioncontrol.lanrelay (Python relay)
```

### Health check
```bash
cd ~/Projects/mission-control
set -a; source .env; set +a
curl -s -X POST http://127.0.0.1:3244/api/gateways/health -H "x-api-key: $API_KEY"
```

### Logs
```bash
tail -f ~/Projects/mission-control/.data/mc.log          # app logs
tail -f ~/Projects/mission-control/.data/lanrelay.log    # relay logs
```

### Restart
```bash
launchctl unload ~/Library/LaunchAgents/ai.missioncontrol.plist
launchctl load   ~/Library/LaunchAgents/ai.missioncontrol.plist
# Relay stays running; no need to restart it for app restarts
```

### Restart relay only
```bash
launchctl unload ~/Library/LaunchAgents/ai.missioncontrol.lanrelay.plist
launchctl load   ~/Library/LaunchAgents/ai.missioncontrol.lanrelay.plist
```

### Stop all
```bash
launchctl unload ~/Library/LaunchAgents/ai.missioncontrol.plist
launchctl unload ~/Library/LaunchAgents/ai.missioncontrol.lanrelay.plist
```

### Manual start (no launchd)
```bash
cd ~/Projects/mission-control
set -a; source .env; set +a
node node_modules/next/dist/bin/next start -p "$PORT" -H "127.0.0.1"
# For LAN access, also run the relay in another terminal:
/usr/bin/python3 scripts/lan-relay.py
```

## Connect from Laptop Browser (LAN)

Open directly from any LAN device — no SSH tunnel needed:

```
http://192.168.0.11:3244
http://marcel.local:3244
```

Auth is required (login page).

### How LAN access works

Next.js binds to `127.0.0.1:3244` only (macOS Application Firewall blocks Homebrew Node from
accepting LAN connections). A Python TCP relay (`scripts/lan-relay.py`, run via
`ai.missioncontrol.lanrelay` launchd) listens on `192.168.0.11:3244` and forwards to
`127.0.0.1:3244`. System Python (`/usr/bin/python3`) is trusted by macOS firewall.

To add another LAN IP for the relay to listen on, edit `lan-relay.py` or update
`RELAY_BIND_HOST` in the plist and reload the service.

**Alternative (SSH tunnel — keeps gateway private):**
```bash
ssh -L 3244:127.0.0.1:3244 -L 18789:127.0.0.1:18789 marcel@192.168.0.11
# Then open http://localhost:3244 on your laptop
```

## After Reboot

- OpenClaw gateway starts via its own service.
- Mission Control starts via `ai.missioncontrol` launchd entry.
- LAN relay starts via `ai.missioncontrol.lanrelay` launchd entry.
- No manual start required after login.

## Updating Mission Control

```bash
cd ~/Projects/mission-control
git pull
pnpm install
pnpm build
launchctl unload ~/Library/LaunchAgents/ai.missioncontrol.plist
launchctl load   ~/Library/LaunchAgents/ai.missioncontrol.plist
```

## If Gateway Token Rotates

```bash
nano ~/Projects/mission-control/.env
# update OPENCLAW_GATEWAY_TOKEN=...
launchctl unload ~/Library/LaunchAgents/ai.missioncontrol.plist
launchctl load   ~/Library/LaunchAgents/ai.missioncontrol.plist
```

## OpenClaw Config Changes Made

None. `~/.openclaw/openclaw.json` was not modified.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Port conflict | Use `PORT=3244` (already configured) |
| App not reachable | `launchctl list \| grep missioncontrol` + check `mc.log` |
| LAN IP unreachable | Check relay: `launchctl list \| grep lanrelay` + `lanrelay.log` |
| Gateway offline in UI | Ensure OpenClaw gateway is running on `127.0.0.1:18789` |
| Auth fails | Re-check `AUTH_PASS` in `.env` and ensure `MC_COOKIE_SECURE=false` for local HTTP use |
| Token errors | Refresh `OPENCLAW_GATEWAY_TOKEN` in `.env` and restart service |

## Rollback

```bash
launchctl unload ~/Library/LaunchAgents/ai.missioncontrol.plist
launchctl unload ~/Library/LaunchAgents/ai.missioncontrol.lanrelay.plist
rm ~/Library/LaunchAgents/ai.missioncontrol.plist
rm ~/Library/LaunchAgents/ai.missioncontrol.lanrelay.plist
rm -rf ~/Projects/mission-control
```

No OpenClaw config rollback needed.
