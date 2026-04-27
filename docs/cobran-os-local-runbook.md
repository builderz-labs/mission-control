# Cobran-OS local runbook

This is the verified local path for running Cobran-OS / Mission Control on Tiago's machine.

## Functional baseline

Cobran-OS is considered locally functional when:

1. dependencies install cleanly for the active Node version;
2. the development server starts on the expected local port;
3. `/setup` renders so an admin account can be created;
4. `/` redirects unauthenticated users to `/login`;
5. protected APIs reject unauthenticated access;
6. lint, typecheck, unit tests, and production build pass.

Gateway-connected features are a second layer: the dashboard can run without a gateway, but live OpenClaw events require gateway host/token configuration.

## Prerequisites

- Node.js `>=22`.
- `pnpm` enabled/installed.
- Native build tooling available for `better-sqlite3` and `node-pty`.
  - Ubuntu/Debian: `python3 make g++`.
  - macOS: Xcode command-line tools.

## Fresh local setup

```bash
git clone https://github.com/builderz-labs/mission-control.git cobran-os
cd cobran-os
pnpm install
cp .env.example .env.local
```

For first local use, either:

- open `http://127.0.0.1:3000/setup` and create the admin account; or
- set `AUTH_USER` / `AUTH_PASS` in `.env.local` before first run.

Do not commit `.env.local` or secrets.

## Start locally

Default port:

```bash
pnpm dev
```

Custom port:

```bash
PORT=3020 pnpm dev
```

Open:

```text
http://127.0.0.1:3020/setup
```

## Verified on 2026-04-27

Environment:

- repo: `/home/agoti/.openclaw/workspace/projects/agoti-mission-control`
- branch checked: `ago-14-cobran-os-verify-local-installstart-path`
- Node: `22.22.0`
- package version: `mission-control@2.0.1`

Commands/results:

```bash
pnpm install
# installed missing dependencies after upstream update; node-pty rebuilt successfully

PORT=3020 pnpm dev
# Next.js ready at http://127.0.0.1:3020
```

Smoke checks:

```bash
curl -s -o /tmp/mc_root.html -w '%{http_code}\n' http://127.0.0.1:3020/
# 307 — redirects unauthenticated user to /login

curl -s -o /tmp/mc_setup.html -w '%{http_code} %{content_type}\n' http://127.0.0.1:3020/setup
# 200 text/html; charset=utf-8 — setup page renders

curl -s -o /tmp/mc_status.json -w '%{http_code} %{content_type}\n' http://127.0.0.1:3020/api/status
# 401 application/json — protected API correctly rejects unauthenticated access
```

## Quality gate

Before calling a branch ready:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Gateway notes

For local-only UI testing, the app can be verified through `/setup`, login, dashboard navigation, and CRUD/API smoke tests without a gateway.

For gateway-connected testing:

1. confirm the OpenClaw gateway is running;
2. set server-side `OPENCLAW_GATEWAY_HOST` / `OPENCLAW_GATEWAY_PORT` as needed;
3. set browser-side `NEXT_PUBLIC_GATEWAY_*` only when the browser needs a different host/URL;
4. rebuild after changing any `NEXT_PUBLIC_*` values.

## Current blockers / risks

- If the repo has just fast-forwarded to a newer upstream version, run `pnpm install` before `pnpm dev`; otherwise `next.config.js` may fail on newly added packages such as `next-intl`.
- The setup/login flow still needs an actual browser/manual pass after account creation to fully validate dashboard navigation.
- Gateway-connected functionality requires a live OpenClaw gateway and appropriate host/token configuration.
