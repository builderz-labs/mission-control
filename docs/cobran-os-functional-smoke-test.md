# Cobran-OS functional smoke test

Use this checklist to decide whether a local Cobran-OS / Mission Control build is functional enough for Tiago to use and report product bugs.

## Functional definition for v1

Cobran-OS v1 is functional when the operator can:

1. install dependencies and start the app locally;
2. create or log into an admin account;
3. open the main dashboard without runtime errors;
4. confirm gateway configuration status;
5. see agents/sessions/tasks from the configured OpenClaw environment when the gateway is running;
6. create, edit, comment on, and move a task through the board;
7. run the quality gate: lint, typecheck, tests, and production build.

The following are **not required** for v1 functional status:

- polished visual design;
- public deployment;
- signed installers;
- multi-tenant production hardening;
- every integration panel being fully configured;
- gateway-connected live data when the OpenClaw gateway is intentionally offline.

## Prerequisites

- Node.js `>=22`.
- `pnpm`.
- Native build tooling for `better-sqlite3` and `node-pty`.
- Optional for gateway smoke: local OpenClaw gateway running and reachable.

## Local start

```bash
git clone https://github.com/builderz-labs/mission-control.git cobran-os
cd cobran-os
pnpm install
cp .env.example .env.local
PORT=3020 pnpm dev
```

Open:

```text
http://127.0.0.1:3020/setup
```

Expected first-run behaviour:

- `/setup` renders an admin setup page if no admin user exists.
- `/` redirects unauthenticated users to `/login`.
- protected APIs return `401` until authenticated.

Quick unauthenticated HTTP smoke:

```bash
curl -s -o /tmp/cobran-root.html -w '%{http_code}\n' http://127.0.0.1:3020/
curl -s -o /tmp/cobran-setup.html -w '%{http_code} %{content_type}\n' http://127.0.0.1:3020/setup
curl -s -o /tmp/cobran-status.json -w '%{http_code} %{content_type}\n' http://127.0.0.1:3020/api/status
```

Expected:

- root: `307` redirect to `/login`;
- setup: `200 text/html`;
- status API: `401 application/json` before login.

## Manual browser smoke

After creating/logging into the admin account:

### Shell/dashboard

- [ ] Main dashboard loads with no red error screen.
- [ ] Left navigation/panels render.
- [ ] Browser console has no repeating runtime error loop.
- [ ] Refreshing the current route keeps the user on a valid panel.

### Gateway

- [ ] Gateway config panel loads.
- [ ] If gateway is offline, the UI shows a clear disconnected/offline state.
- [ ] If gateway is online, connection status becomes connected/healthy.
- [ ] Browser-side gateway URL matches the local access mode:
  - local direct: `ws://127.0.0.1:18789`;
  - HTTPS reverse proxy: `wss://...` through the proxy path/host.

### Agents and sessions

- [ ] Agents panel renders.
- [ ] Existing configured agents are listed when gateway data exists.
- [ ] Opening an agent detail view does not crash.
- [ ] Sessions/transcripts render for at least one agent/session when available.

### Tasks

- [ ] Task board renders all core columns.
- [ ] Create Task modal opens.
- [ ] Creating a minimal task succeeds, or shows a visible error message if the API rejects it.
- [ ] Task Detail modal opens from the created task/card.
- [ ] Comment submission works, or shows a visible error message.
- [ ] Edit Task modal opens.
- [ ] Editing title/status/priority succeeds, or shows a visible error message.
- [ ] Dragging/moving status updates the task or shows a clear failure.

### Quality review / dispatch basics

- [ ] Quality Review tab renders in task detail.
- [ ] Approve/reject review action succeeds or shows a visible error.
- [ ] Dispatch controls are either usable with configured agents or clearly disabled/explained.

## Automated quality gate

Run before merging a Cobran-OS functional change:

```bash
pnpm typecheck
pnpm lint
GIT_AUTHOR_NAME=Bob GIT_AUTHOR_EMAIL=bob@openclaw.local \
GIT_COMMITTER_NAME=Bob GIT_COMMITTER_EMAIL=bob@openclaw.local \
pnpm test
pnpm build
```

Notes:

- The `GIT_*` environment variables keep GNAP sync tests deterministic in environments without global git identity.
- Current lint may pass with existing React hook dependency warnings; treat new warnings as regressions.

## Known functional risks to check before calling it done

- Auth/setup can block manual dashboard smoke if the local `.data` state already contains users with unknown credentials.
- Gateway-connected panels depend on a running OpenClaw gateway and correct `OPENCLAW_GATEWAY_*` / `NEXT_PUBLIC_GATEWAY_*` values.
- `NEXT_PUBLIC_*` changes require a rebuild for production mode.
- Native dependencies may need rebuild after Node version changes: `pnpm rebuild better-sqlite3 node-pty`.

## Reporting result

When reporting a smoke run, include:

```text
Repo/branch/commit:
Environment: OS, Node, pnpm
Start command:
Gateway state: offline / connected / not tested
Automated gate: typecheck, lint, test, build
Manual smoke: pass/fail list
Blockers:
Next action:
```
