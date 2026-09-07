# Mission Control Fly command workers

Current design: one canonical local Mission Control backend at port 3000, shared by the native app and MCP clients. This runbook supersedes the earlier callback/cloud-control/r3/r4 instructions. Those image digests do not commission the new polled protocol.

## What runs where

The active agent and its subscription remain on the Mac. Approved, clean, pushed Git revisions can run named package checks on Fly. Mac-only work, dirty/unpushed changes, secrets, deploys, migrations, coordination and review remain local. Fly does not inherit desktop subscription credentials.

Admitted runtime is `command`. No Anthropic/OpenAI API key or publicly reachable callback URL is required. Remote Claude/Codex inference is intentionally not commissioned. Calling a swarm skill or Remote Control does not itself create Machines. Every eligible leaf must pass through `mc_submit_fly_leaf`.

The durable SQLite admission queue supports 1,000 outstanding leaves, stable request IDs, atomic global reservations, at most two infrastructure attempts, one isolated checkout/branch per attempt, and a 24-hour queue deadline. Command workers do not push changes. Successful verification creates a task in review for the active agent.

## Commissioning status

Command success, bounded failure, cancellation, replay and Machine cleanup were exercised against live Machines on a reference deployment with a shared capacity of 25, within compute budgets. Re-commission against your own account before raising capacity; results here are not a guarantee for another org.

For a new environment: use an authorized read-only Doppler service token, publish immutable images, verify regional prices and repositories, deploy a backed-up backend, then test at cap 1 before ramping toward 25. Do not precreate idle Machines.

### Doppler presence-only preflight

```sh
cd /path/to/mission-control
doppler run --project mission-control --config prd --no-fallback -- node -e 'for (const k of ["FLY_API_TOKEN","MC_FLY_WORKER_APP","MC_FLY_POLL_PROTOCOL","MC_FLY_CORE_IMAGE","MC_FLY_ALLOWED_REPOS"]) console.log(k+":"+(process.env[k]?"set":"missing"))'
```

Restricted secrets require a non-user service token; a user CLI login alone will always fail this preflight. Use the supported Doppler service-token creation flow when authorized. A service-token access denial requires an administrator; do not recover credentials through another store. Never paste secrets into chat or put them on a command line.

### Required runtime configuration

```dotenv
MC_FLY_ENABLED=false
MC_FLY_WORKER_APP=your-worker-app
FLY_REGION=iad
MC_FLY_POLL_PROTOCOL=1
MC_FLY_ALLOWED_REPOS=https://github.com/YOUR_ORG/YOUR_REPO.git
MC_FLY_CORE_IMAGE=registry.fly.io/your-worker-app@sha256:VERIFIED_CORE_DIGEST
MC_FLY_BROWSER_IMAGE=registry.fly.io/your-worker-app@sha256:VERIFIED_BROWSER_DIGEST
MC_FLY_MAX_WORKERS=1
MC_FLY_PER_JOB_BUDGET_USD=0.25
MC_FLY_DAILY_BUDGET_USD=3
MC_FLY_MONTHLY_BUDGET_USD=40
MC_FLY_CORE_SMALL_HOURLY_USD=VERIFIED_REGIONAL_RATE
MC_FLY_CORE_STANDARD_HOURLY_USD=VERIFIED_REGIONAL_RATE
MC_FLY_CORE_PERFORMANCE_HOURLY_USD=VERIFIED_REGIONAL_RATE
MC_FLY_BROWSER_STANDARD_HOURLY_USD=VERIFIED_REGIONAL_RATE
MC_FLY_BROWSER_LARGE_HOURLY_USD=VERIFIED_REGIONAL_RATE
```

Keep `FLY_API_TOKEN` only in the control-plane environment, scoped to the dedicated app. Optional `MC_FLY_GIT_AUTH_TOKEN` must be short-lived/read-only and limited to approved repositories. No Fly token, Mission Control API key, Doppler token, model credential, public service, volume, or desktop OAuth file is injected into a command worker.

Rate values and digests above are placeholders, not usable configuration. Unknown prices or mutable image tags fail closed. Defaults are not live settings; the deployed environment must be checked separately.

### Operator-only image commissioning

Agents must not invoke Fly directly. A deployment operator can use an authenticated Docker registry session and the Docker CLI below after reviewing the image source; clean independent builds are otherwise submitted through Mission Control per global routing policy. Each image intentionally omits unused model CLIs.

```sh
docker buildx build --platform linux/amd64 --provenance=false --push -f workers/core/Dockerfile -t registry.fly.io/your-worker-app:polled-core-v1 .
docker buildx build --platform linux/amd64 --provenance=false --push -f workers/browser/Dockerfile -t registry.fly.io/your-worker-app:polled-browser-v1 .
docker buildx imagetools inspect registry.fly.io/your-worker-app:polled-core-v1
docker buildx imagetools inspect registry.fly.io/your-worker-app:polled-browser-v1
```

Use returned digests in your secret store. Do not run `fly deploy` to stand up a second controller against the same worker pool: one scheduler owns the durable queue. No Vercel deployment is needed for this persistent local SQLite scheduler.

### Backend build and start

Use Node from `.nvmrc` and pnpm. This repository has dirty/local-only consolidation work: do not publish it just to obtain a remote build. Build/deployment must preserve the existing running standalone artifact, its environment, and the live database backup. Do not run the repository's broad deploy helper unattended: it can pull source and stop listeners.

After an isolated, verified build is promoted during a controlled restart:

```sh
doppler run --project mission-control --config prd --no-fallback -- pnpm start:standalone
```

The installed launchd wrapper already injects its scoped service token and opts into `MC_USE_DOPPLER=1`; startup loads Doppler after local dotenv. Run exactly one backend on 3000. Use the existing launchd owner to restart that process; do not start a second scheduler against the same database. For new environments keep `MC_FLY_ENABLED=false` until commissioning is ready; the canonical controller has completed commissioning.

## Client setup and active sessions

All capable clients use `node /path/to/mission-control/scripts/mc-mcp-server.cjs`, with the existing protected Mission Control profile or `MC_URL`/`MC_API_KEY` environment. For a Claude Code installation missing this server:

```sh
claude mcp add --transport stdio --scope user mission-control -- node /path/to/mission-control/scripts/mc-mcp-server.cjs
```

Do not overwrite a working registration. In an active Claude Code session, open `/mcp` and reconnect Mission Control if the tool list is stale. Confirm `mc_fly_status` returns structured `transport: polled` and inspect issues. Configuration readiness alone is not a live canary. If reconnect is unsupported by that client, resume the session after reloading its MCP registration.

Submit a leaf through the tool, not arbitrary shell text:

```json
{
  "title": "Pinned revision smoke",
  "description": "Verify checkout and runtime availability",
  "repository": "https://github.com/YOUR_ORG/YOUR_REPO.git",
  "base_sha": "FULL_PUSHED_40_CHARACTER_SHA",
  "runtime": "command",
  "setup": "none",
  "checks": ["smoke"],
  "timeout_seconds": 60,
  "request_id": "commission-smoke-v1",
  "session_id": "EXACT_SOURCE_SESSION_ID"
}
```

`smoke` verifies checkout/runtime only, not application correctness. Use `pnpm-ci` or `npm-ci` and the smallest named checks for actual verification. Browser setup does not itself run e2e: the selected repository script must execute the browser suite. Missing package scripts fail rather than silently pass.

Accepted/unknown submissions retain remote ownership across disconnects. Retry the same request ID and identical payload. Never run a duplicate locally. `mc_cancel_fly_leaf` releases queued/unlaunched submissions only; cancellation is idempotent. Host disk policy still applies after a confirmed release.

A generic desktop chat without MCP tool execution cannot automatically offload. Mirroring its transcript in Mission Control is not command interception. Claude Remote Control keeps execution local and preserves local tools; it is not Fly orchestration. [Claude Remote Control](https://code.claude.com/docs/en/remote-control), [MCP configuration](https://code.claude.com/docs/en/mcp).

## Operations, observability, rollback

Fly reconciliation runs every 15 seconds independently of normal 60-second scans. Idle queues produce no provider polling. Creates are paced, with three launches per cycle. Credentials/network failure never releases active ownership. The worker's own work deadline, process-group termination, 120-second result retention, restart=no and auto_destroy bound normal unattended jobs. Control-plane outages can lose results; they do not justify duplicate local execution.

`/fly` displays the Mac → scheduler → queue → fleet → cost flow, current class telemetry, bottlenecks and the latest 100 attempts. Mission Control session chats show the official Fly logo, active worker count and cumulative estimated compute when submissions carry the exact source session ID. Polling is five seconds, pauses in hidden tabs, and prevents overlapping fetches. This cannot install a live custom badge inside another vendor's desktop chat UI.

The unmodified informational logo is from [Fly's official brand assets](https://fly.io/docs/about/brand/). Fly.io retains its trademarks; the integration does not imply sponsorship or endorsement.

Costs are elapsed-time compute estimates, not provider invoices. Admission reserves timeout + 300 seconds. Cumulative per-job attempts, daily UTC and monthly UTC budgets share one global ledger; workspace/session telemetry remains scoped. Egress, storage, image builds, and inference are not budgeted by this ledger. Confirm actual invoice spend separately before scaling.

Pause new launches via `fly.enabled=false` in scheduler settings; reconciliation continues draining. Or disable `MC_FLY_ENABLED` at the next controlled restart without removing credentials needed for cleanup. Poll until active ownership is zero. Roll back source/images only after draining; retain additive database migration 062 and the backup. Never roll the live DB back while Machines remain owned.

## Verification commands

```sh
node --test scripts/mc-fly-contract.test.cjs workers/tests/*.test.mjs
pnpm exec vitest run src/lib/__tests__/fly-*.test.ts src/components/panels/fly-orchestration-panel.test.tsx src/components/chat/session/fly-session-status.test.tsx --maxWorkers=1
pnpm typecheck
pnpm api:parity
```

Use Mission Control for eligible clean heavy verification; dirty local source stays local. Browser/e2e and live-image commissioning remain separate release gates.

## Active-session CLI bridge

Existing Claude, Codex, Kimi and Grok sessions with stale MCP tool lists can use the same validated handlers immediately:

```sh
node /path/to/mission-control/scripts/mc-fly.cjs status
node /path/to/mission-control/scripts/mc-fly.cjs submit /absolute/path/leaf.json
node /path/to/mission-control/scripts/mc-fly.cjs cancel /absolute/path/cancellation.json
```

The bridge reads the same protected local profile and preserves request IDs, bounded retries, budgets and ownership. Do not put secrets in payloads. `safe_local_fallback: false` means no duplicate local execution. A cancellation payload contains `submission_id`.

For browser jobs select `pnpm-ci-playwright` or `npm-ci-playwright`. `smoke` now installs the repository-pinned dependencies and launches Chromium to verify rendering; `test:e2e` runs the repository's explicit package script. Use `build` before `test:e2e` when the suite needs a production build.

## What the Fly dashboard means

The worker app named by `MC_FLY_WORKER_APP` is the disposable compute pool. It has zero Machines while idle and creates up to the configured shared limit when accepted jobs need them, subject to budgets and provider capacity. The scheduler starts up to three per reconciliation pass, pacing provider requests. Machines disappear after results and cleanup.

Exactly one scheduler owns the durable queue. If you also keep a Mission Control app deployed on Fly, leave its worker admission disabled: it is not an automatic failover replica, and offload reconciliation requires the owning controller to stay reachable. Never run two independent databases as schedulers for the same pool.

Fly command capacity is independent of native LLM subagent capacity. Cloud LLM inference is not commissioned; provider authentication, inference budgets, and client runtime support require separate configuration. Native running sessions cannot be retroactively given 25 slots through a Fly Machine setting.
