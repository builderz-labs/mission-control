# Mission Control CLI for Agent-Complete Operations (v2)

This repository includes a first-party CLI at:

- scripts/mc-cli.cjs

Designed for autonomous/headless usage first:
- API key auth support
- Profile persistence (~/.mission-control/profiles/*.json)
- Stable JSON mode (`--json`) with NDJSON for streaming
- Deterministic exit code categories
- SSE streaming for real-time event watching
- Compound subcommands for memory, soul, comments

## Quick start

1) Ensure Mission Control API is running.
2) Set environment variables or use profile flags:

- MC_URL=http://127.0.0.1:3000
- MC_API_KEY=your-key

3) Run commands:

```bash
node scripts/mc-cli.cjs agents list --json
node scripts/mc-cli.cjs tasks queue --agent Aegis --max-capacity 2 --json
node scripts/mc-cli.cjs sessions control --id <session-id> --action terminate
```

## Command groups

### auth
- login --username --password
- logout
- whoami

### agents
- list
- get --id
- create --name --role [--body '{}']
- update --id [--body '{}']
- delete --id
- wake --id
- diagnostics --id
- heartbeat --id
- attribution --id [--hours 24] [--section identity,cost] [--privileged]
- memory get --id
- memory set --id --content "..." [--append]
- memory set --id --file ./memory.md
- memory clear --id
- soul get --id
- soul set --id --content "..."
- soul set --id --file ./soul.md
- soul set --id --template operator
- soul templates --id [--template name]

### tasks
- list
- get --id
- create --title [--body '{}']
- update --id [--body '{}']
- delete --id
- queue --agent <name> [--max-capacity 2]
- broadcast --id --message "..."
- comments list --id
- comments add --id --content "..." [--parent-id 5]

### sessions
- list
- control --id --action monitor|pause|terminate
- continue --kind claude-code|codex-cli --id --prompt "..."
- transcript --kind claude-code|codex-cli|hermes --id [--limit 40] [--source]

### connect
- register --tool-name --agent-name [--body '{}']
- list
- disconnect --connection-id

### tokens
- list [--timeframe hour|day|week|month|all]
- stats [--timeframe]
- by-agent [--days 30]
- agent-costs [--timeframe]
- task-costs [--timeframe]
- trends [--timeframe]
- export [--format json|csv] [--timeframe] [--limit]
- rotate (shows current key info)
- rotate --confirm (generates new key -- admin only)

### skills
- list
- content --source --name
- check --source --name
- upsert --source --name --file ./skill.md
- delete --source --name

### cron
- list
- create/update/pause/resume/remove/run [--body '{}']

### events
- watch [--types agent,task] [--timeout-ms 3600000]

  Streams SSE events to stdout. In `--json` mode, outputs NDJSON (one JSON object per line). Press Ctrl+C to stop.

### status
- health (no auth required)
- overview
- dashboard
- gateway
- models
- capabilities

### export (admin)
- audit [--format json|csv] [--since <unix>] [--until <unix>] [--limit]
- tasks [--format json|csv] [--since] [--until] [--limit]
- activities [--format json|csv] [--since] [--until] [--limit]
- pipelines [--format json|csv] [--since] [--until] [--limit]

### raw
- raw --method GET --path /api/... [--body '{}']

## Exit code contract

- 0 success
- 2 usage error
- 3 auth error (401)
- 4 permission error (403)
- 5 network/timeout
- 6 server error (5xx)

## API contract parity gate

To detect drift between Next.js route handlers and openapi.json, use:

```bash
node scripts/check-api-contract-parity.mjs \
  --root . \
  --openapi openapi.json \
  --ignore-file scripts/api-contract-parity.ignore
```

Machine output:

```bash
node scripts/check-api-contract-parity.mjs --json
```

The checker scans `src/app/api/**/route.ts(x)`, derives operations (METHOD + /api/path), compares against OpenAPI operations, and exits non-zero on mismatch.

Baseline policy in this repo:
- `scripts/api-contract-parity.ignore` currently stores a temporary baseline of known drift.
- CI enforces no regressions beyond baseline.
- When you fix a mismatch, remove its line from ignore file in the same PR.
- Goal is monotonic burn-down to an empty ignore file.

## I merged a fix — how do I roll all agents?

After a fix lands in ender-stack and a new image is pushed (the SSM image-pin
auto-updates), every agent must be rolled onto a fresh task to pick it up.
Rolling them one at a time is error-prone — skipped agents silently run stale
code. `POST /api/fleet/bulk-redeploy` (operator role) rolls a filtered set in
one call. Invoke it via the `raw` passthrough:

```bash
# Roll EVERY agent harness in the cluster.
node scripts/mc-cli.cjs raw --method POST --path /api/fleet/bulk-redeploy \
  --body '{"filter":{"mode":"all"}}' --json
```

**Confirmation for large batches.** When the resolved target count is > 5, the
first call returns `400 ConfirmationRequired` with the exact count and the
token to echo back. Re-send with that token:

```bash
# → {"error":"ConfirmationRequired","count":7,"expected":"REDEPLOY-7-AGENTS"}
node scripts/mc-cli.cjs raw --method POST --path /api/fleet/bulk-redeploy \
  --body '{"filter":{"mode":"all"},"confirm":"REDEPLOY-7-AGENTS"}' --json
```

**Roll a specific subset** (exact ECS service names). The whole batch is
rejected atomically — no agent is rolled — if any name is missing/inactive
(`404 ServiceNotFoundException`) or isn't an MC-managed harness
(`400 NotAgentHarness`):

```bash
node scripts/mc-cli.cjs raw --method POST --path /api/fleet/bulk-redeploy \
  --body '{"filter":{"mode":"explicit","services":["ender-stack-dev-companion-openclaw-alice","ender-stack-dev-companion-openclaw-bob"]}}' \
  --json
```

A `202` returns `{ ok, mode, count, results:[{ service, deploymentId?, ok, error? }] }`.
Only `forceNewDeployment` is ever sent — never a scale or task-def change.
Per-service `UpdateService` failures are reported per-row (`ok:false`) without
unwinding the batch; the atomic guarantee is the pre-flight harness check.
There's also a `by-tag` mode (`{"mode":"by-tag","tagKey":"…","tagValue":"…"}`).

**From the UI:** the Fleet panel's **Bulk redeploy** button opens a modal with
"All agent harnesses" / "Select specific agents", the same confirmation step,
and a per-agent result summary; rollout progress then shows in the table.

## Next steps

- Promote script to package.json bin entry (`mc`).
- Add retry/backoff for transient failures.
- Add integration tests that run the CLI against a test server fixture.
- Add richer pagination/filter flags for list commands.
