# Fly scale and cost decision — 2026-09-06

## Recommendation

One local Mission Control scheduler, SQLite durable queue, disposable polled command workers, and local subscription agents. No second cloud controller, callback tunnel, Redis, Kubernetes, model gateway, or permanently idle fleet is needed for this workload. This is the lowest-complexity fit for the current single-host deployment; it is not a claim of optimality under every workload.

The commissioned shared pool admits up to 25 workers. Core and browser command leaves have passed on Fly, and four simultaneous Machines were independently observed. Logical agents can queue leaves without keeping an idle Machine per agent. Native swarm worker count is separate from Fly compute capacity and remains subject to host slots and the user's swarm policy.

## Architecture

```text
Local active agent + subscription + project policy
                   |
       mc_submit_fly_leaf (clean, pushed SHA)
                   |
Mission Control :3000 — durable admission + global budgets
                   |
    paced reservation / create / observe / cleanup
                   |
       core or browser disposable Fly Machine
                   |
        fixed state-file poll via Machines exec
                   |
     confirmed absence → settle task → active-agent review
```

Mac-only/dirty work never enters this queue. Accepted jobs cannot become local duplicates. A separate 15-second loop prevents slow local scans from starving worker observation; normal scans remain at 60 seconds.

## Sizing and growth

| Class | CPU | RAM | Intended use |
| --- | --- | --- | --- |
| core-small | 1 shared | 1 GB | Smoke / small network-bound checks |
| core-standard | 1 shared | 2 GB | Modest memory-heavy checks |
| core-performance | 2 performance | 4 GB | Builds, tests, compilation |
| browser-standard | 2 performance | 4 GB | Browser verification |
| browser-large | 4 performance | 8 GB | Measured browser resource pressure |

Selection uses comparable repository/setup/runtime/check history (latest 50 successful samples), CPU saturation normalized to VM cores, and 25% memory headroom. Missing prices, image digests, or insufficient approved memory capacity decline admission. Runtime and cost history are retained; causal speed/cost optimization across sizes still needs real benchmark data. Do not interpret a heuristic as measured optimization.

Gate the ramp on exact revision results, no duplicate ownership, confirmed cleanup, queue wait, p95 runtime, retries, actual resource peaks and invoice comparison. The current 500-enqueue test is simulated admission coverage, not a 500-job provider load test or an SLA. Regional failover, checkpoint/result object storage and stopped-pool leasing are deferred until observations justify their operational cost.

Fly documents action rate limits with a one-request/second baseline and a burst of three for most operations. The paced admission avoids a cold 30-create fan-out. [Machines API rate limits](https://fly.io/docs/machines/api/working-with-machines-api/).

Stopped Machines retain billed rootfs, so a 28-stopped-worker reserve is not free and is unsupported by this create-per-job implementation. Start with zero idle Machines. [Fly billing](https://fly.io/docs/about/billing/).

## Anticipated cost — transparent scenarios

Formula: jobs × (work seconds + collection/start allowance) / 3600 × verified regional hourly rate. Retries add runtime; concurrency changes wall time, not nominal task CPU-hours. Actual billed started-state time differs from the conservative control-plane observation window.

At an illustrative $0.10/hour, 500 ten-minute leaves cost about $8.33 for work alone. A 30-second per-leaf allowance raises that to $8.75. Reserving a 900-second timeout plus 300-second safety window reserves at most $0.0333 per attempt; 500 such reservations total $16.67 before released headroom. Two attempts can double consumed compute, but each submission still shares its configured cumulative per-job cap. These are assumptions, not a regional price quote or invoice.

At 25 continuously productive slots and ten-minute average work, 500 leaves take an idealized 3.33 hours before startup, dependencies, budgets and failures. This is arithmetic, not measured throughput or a promise that the configured daily budget admits all 500 jobs.

Read current regional rates at [Fly pricing](https://fly.io/docs/about/pricing/). Set all selected-class prices explicitly. Scoped Doppler configuration and independent Fly inventory were verified. Admission uses explicit regional rates with $0.25/job, $3/day and $40/month compute budgets. Reported spend is a control-plane estimate, not a reconciled provider invoice. See [commissioning evidence](fly-commissioning-2026-09-06.md).

## Cost improvements already implemented

- No extra controller, queue service, callback ingress or idle fleet.
- Command-only images omit unused Claude/Codex CLIs and packages.
- Dedicated core/browser images avoid browser payload for ordinary checks.
- No all-history job arrays in telemetry; aggregate in SQLite and fetch active rows only.
- Status avoids per-submission database query fan-out; response detail is bounded to 100 submissions/attempts.
- No provider poll when idle; no overlapping UI refresh; hidden-tab polling pauses.
- Global reservation includes cleanup and unknown launches; retries share a cumulative job cap.

## Deliberate limits

One durable host remains a single availability boundary. Generic desktop chats require an actual MCP-capable execution adapter; transcript mirroring alone is insufficient. Large-history rollups, dependency DAG execution, multi-region recovery, per-class fairness quotas and runtime/cost-trained sizing are future work, not implemented guarantees. Application scripts execute approved repository code and must not be treated as hostile multi-tenant sandbox workloads.

## Recovery and skill integration

All four provider registrations and canonical swarm/Ruflo skills use `~/.agents/skills/_shared/fly-command-contract.md`, also projected into their global rules. Existing tool snapshots can invoke the same MCP handlers through `scripts/mc-fly.cjs`. Stable request/session/swarm IDs preserve attribution and idempotency.

Scheduler ownership renews every 30 seconds during slow provider calls and is fenced on loss. Provider Retry-After is honored up to ten seconds per retry. Polling prioritizes least recently observed workers. Completed results remain available for the remaining reserved Machine lease; successful collection destroys the worker early. An absent worker with an old cached heartbeat can settle and enter bounded retry instead of remaining stuck indefinitely.

This reduces short-outage losses but cannot survive arbitrary Mac downtime. Moving the single canonical scheduler and database to Fly requires an explicit hosting decision and a migration with the local scheduler stopped. Do not start the retained cloud controller as an unsynchronized second scheduler.
