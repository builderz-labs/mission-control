# OpenClaw → Hermes migration (in-app)

This doc lists OpenClaw-related functionality that has been migrated or extended for Hermes.

## Done

### 1. Security scan — Gateway category + Hermes state

- **Gateway config** (formerly “OpenClaw”): Uses `config.gatewayConfigPath` (Hermes `gateway.json` when `HERMES_HOME` is set, else `openclaw.json`). All check labels say “Gateway” not “OpenClaw”.
- **Hermes state checks** (when `HERMES_HOME` is set):
  - **Hermes state directory permissions** — `HERMES_HOME` dir exists and mode is 0700 or 0750 (warn if too open).
  - **Hermes session store** — `state.db` or `sessions/` under `HERMES_HOME` (warn if missing).
  - **Hermes credentials / OAuth dir** — `credentials/` under `HERMES_HOME` (warn if missing; optional for OAuth).
- **Fix route** — Result labels use “Gateway config permissions” and “Write gateway config” instead of “OpenClaw config”.

### 2. Doctor (GET) — Hermes fallback

- When OpenClaw CLI is not installed but `config.hermesHome` is set, `GET /api/openclaw/doctor` returns a status built from the **Gateway** security-scan category (same checks as above). No 400 “OpenClaw is not installed” in Hermes-only mode.
- New helper: `statusFromGatewayChecks()` in `openclaw-doctor.ts` builds `OpenClawDoctorStatus` from the scan’s Gateway checks.

### 3. Skills — Hermes root

- **skill-sync** and **skill-registry**: When `config.hermesHome` is set, a **hermes** skill root is added: `HERMES_HOME/skills` (override with `MC_SKILLS_HERMES_DIR`).
- **Skills panel**: “~/.hermes/skills (Hermes)” appears in the source/target dropdowns in gateway mode. Hermes group uses emerald styling.
- Existing **openskills / OpenClaw** registries (ClawdHub, skills.sh, Awesome OpenClaw) are unchanged; install target can be `hermes` when Hermes is configured.

### 4. Hermes version API

- **GET /api/hermes/version** — Returns `{ installed, latest, updateAvailable, ... }`. `installed` is parsed from `hermes-agent --version` (or `HERMES_BIN`). No update check yet (`latest` / `updateAvailable` left for future use).

### 5. Update / Doctor UI and copy

- **OpenClaw update banner** — Still driven by `/api/openclaw/version`; only shows when OpenClaw reports an update. Hermes version is available at `/api/hermes/version` for future “Hermes vX” display.
- **Doctor banner** — In Hermes-only mode, doctor GET now returns Gateway/Hermes state checks instead of “OpenClaw is not installed”, so the banner can show Gateway/Hermes issues (e.g. state dir permissions, session store missing).

## Still OpenClaw-specific (unchanged)

- **Update check** — `/api/openclaw/version` and OpenClaw update banner (OpenClaw only).
- **Doctor POST (fix)** — Still runs `openclaw doctor --fix` and OpenClaw session cleanup; no Hermes fix path yet.
- **Task dispatch** — `runOpenClaw` / `callOpenClawGateway` in `task-dispatch.ts` (OpenClaw CLI/gateway).
- **Super-admin** — Tenant provisioning and `openclaw-gateway@.service` (OpenClaw).
- **Sessions** — `sessions.ts` still has OpenClaw state dir for agent session stores; Hermes sessions use `hermes-sessions.ts` and `state.db`.
- **Skills registries** — “Awesome OpenClaw” and other registries unchanged; Hermes/openskills as a **search** source can be added later.

## Env / config

- **Hermes**: `HERMES_HOME` (default `~/.hermes`), `HERMES_GATEWAY_HOST`, `HERMES_GATEWAY_PORT`, `HERMES_GATEWAY_TOKEN`, `MC_SKILLS_HERMES_DIR`.
- **Legacy**: `OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH`, `OPENCLAW_STATE_DIR` still used where OpenClaw paths are needed.
