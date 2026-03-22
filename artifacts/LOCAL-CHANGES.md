# Local Changes (Mission Control × OpenClaw)

This file documents local, non-upstream changes made on this machine.

Updated: 2026-03-22

## Why this exists
These changes are local integration fixes/overrides. If you run `git pull`, these may need to be re-applied (especially if upstream touches the same files).

## Local code/config changes

### 1) OpenClaw health endpoint compatibility
- **File:** `src/app/api/gateways/health/route.ts`
- **Change:** probe path `/api/health` -> `/health`
- **Reason:** OpenClaw gateway responds on `/health`.

### 2) Native build dependencies allowed in pnpm
- **File:** `package.json`
- **Change:** added native packages to `pnpm.onlyBuiltDependencies`.
- **Reason:** required for reliable local build/install.

### 3) Service wrapper for env loading
- **File:** `scripts/start-service.sh`
- **Change:** launch wrapper that sources `.env` and starts standalone server.
- **Reason:** ensures launchd service starts with full runtime env.

### 4) Launchd service definition
- **File:** `~/Library/LaunchAgents/ai.missioncontrol.plist`
- **Change:** user-level service to auto-start app at login.
- **Port:** set to `3244`.

### 5) Runtime env wiring
- **File:** `.env` (local-only, secret)
- **Change:** OpenClaw integration vars + auth/API secrets + host/port settings.
- **Important:** do not commit `.env`.

## Current runtime defaults on this machine
- App URL: `http://localhost:3244`
- OpenClaw gateway target: `127.0.0.1:18789`
- Host allowlist is set in `.env` via `MC_ALLOWED_HOSTS`

## Quick re-apply checklist (after upstream updates)
```bash
cd ~/Projects/mission-control

# 1) Check what changed upstream
git fetch

git status --short

# 2) Verify the health route still uses /health
grep -n "api/health\|/health" src/app/api/gateways/health/route.ts

# 3) Rebuild and restart service
pnpm install
pnpm build
launchctl unload ~/Library/LaunchAgents/ai.missioncontrol.plist
launchctl load   ~/Library/LaunchAgents/ai.missioncontrol.plist

# 4) Validate
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3244/login
```

## Diff commands
```bash
cd ~/Projects/mission-control

git diff -- package.json src/app/api/gateways/health/route.ts scripts/start-service.sh
plutil -p ~/Library/LaunchAgents/ai.missioncontrol.plist
```


### 6) Login + static assets regression fix (2026-03-22)
- **Files:** `scripts/start-service.sh`, `.env`
- **Changes:**
  - switched launcher to `next start` (instead of standalone server invocation)
  - set `MC_COOKIE_SECURE=false` for local HTTP
  - added `MC_BIND_HOST=0.0.0.0`
- **Reason:** fixed CSS/JS assets being served as HTML and fixed login session cookie persistence.


### 7) Gateway token mismatch fix (2026-03-22)
- **Files:** `scripts/start-service.sh`, `~/.openclaw/openclaw.json`
- **Changes:**
  - `start-service.sh`: removed unsafe fallback that called `openclaw config get gateway.auth.token`
    (OpenClaw CLI redacts secrets; fallback poisoned `OPENCLAW_GATEWAY_TOKEN` with `__OPENCLAW_REDACTED__`).
    Token now sourced exclusively from `.env`.
  - `openclaw.json`: added `gateway.remote.token` = `gateway.auth.token`
    (lets `openclaw gateway call ...` commands authenticate to the local gateway).
- **Reason:** `[ERROR] WebSocket: Gateway error: unauthorized: gateway token mismatch`; UI showed gateway offline.
