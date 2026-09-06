# Fly recovery and shared skill hardening — 2026-09-06

## Implemented

- Renew scheduler ownership every 30 seconds independently of provider I/O; reject further admission after loss and preserve successor ownership on release.
- Prioritize workers with the oldest observation. Honor provider Retry-After with a ten-second bound per retry; retain ambiguous launch reservations instead of recreating Machines.
- Reject stale live heartbeats while allowing cached state from a confirmed absent worker to settle and enter bounded retry. This removes a permanent reservation leak after controller downtime.
- Retain completed results for the remainder of the already-budgeted Machine lease, bounded to 35 minutes. Successful collection destroys the Machine early. This is bounded recovery, not durable result storage.
- One command contract is linked by all ten canonical swarm/Ruflo entrypoints and their shared orchestration policy. Global rules project the contract to Claude, Codex, Kimi and Grok, covering installed plugin skills as well. All four skill directories resolve to the canonical root.
- Existing sessions can invoke `scripts/mc-fly.cjs`; it calls the same MCP handlers, admission, budgets and ownership logic. Rule files do not hot-reload a host's native subagent capacity or cached instructions.

## Verification

34 focused backend tests and 14 lifecycle/runtime tests passed. Focused lint has zero warnings; production build and standalone artifact checks passed. All four actual client configurations initialized the same 52-tool MCP server and returned ready status after deployment. Both r10 containers passed bounded-retention execution checks.

The r10 images contain the recovery changes. Their package-installation layers are identical to r9; browser user/cache setup was regenerated after the worker source layer. The r9 scanner findings remain relevant, including 5 critical/108 high findings attributed to development headers. No new full vulnerability scan or Fly runtime-kernel assessment is claimed. See the commissioning report for scope.

## Forecast and operating boundaries

| Trigger | Implemented handling | Remaining boundary |
| --- | --- | --- |
| More than 25 simultaneous leaves | Transactional shared cap, queue, paced launches | 25-way paid load has not been benchmarked; four simultaneous Machines were observed |
| Provider throttling or slow calls | Timeouts, bounded retries, Retry-After, independent lease renewal | Provider quotas and outages remain external |
| Ambiguous create response | Stable launch identity and retained reservation | No duplicate local fallback while ownership is retained |
| Brief controller interruption | Reserved result-retention window and recovery reconciliation | Long outages can lose results and require bounded retry |
| Mac sleep or loss | Durable local queue, launchd recovery, bounded worker lifetime | Always-on scheduling requires a canonical controller/database migration |
| Compute budget reached | Admission queues rather than overspending reservations | $0.25/job, $3/day, $40/month; estimates exclude inference/storage/egress |
| Large dependency or browser workload | Resource classes, memory headroom, real Chromium smoke, native compiler support | Size selection is heuristic; additional workload benchmarks are needed |
| Dependent swarm steps | Ordered checks or wait for successful prerequisite | Arbitrary dependency DAG execution is not implemented |
| Stale agent tool snapshot | Same-handler CLI bridge | Native agent slot changes require host support/reload |
| Cloud LLM execution requested | Command-only admission avoids unbudgeted inference | Four-provider cloud inference runtimes are not commissioned |
| Credential revocation/rotation | Scoped Doppler injection, no cached fallback | Rotation requires updating the protected service credential and revalidation |

Keep one canonical scheduler. The stopped Fly controller and its volume are retained infrastructure, not automatic failover; do not activate it against this pool with a separate database. The hosting decision remains pending. No automatic monitor or extra idle fleet was created.
