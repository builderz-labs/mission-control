# Fly cleanup and capacity audit — September 6, 2026

One local controller owns the shared Fly command queue for Claude, Codex, Kimi,
Grok and their Ruflo/swarm workflows. The configured maximum is 25 Machines across
all sessions, subject to budgets and provider availability. Native LLM subagent
slots are determined by the host and cannot be changed by this pool.

## Apps and resources

- `mission-control-workers-tyler`: disposable command Machines in `iad`, created
  on demand, no public services or persistent volumes, automatic destruction and
  no Machine restart loop. Machine count reflects current work, not pool capacity.
- `mission-control-control-tyler`: retained stopped controller with a 3 GB volume.
  Automatic startup is now disabled through the Fly CLI and in `fly.toml`.
  The volume is persistent disk, not worker RAM. It has not been deleted or merged
  into the canonical local database. This is not an active replica or failover.

The retained controller still incurs storage charges. Fly bills volumes even when
Machines are stopped, and stopped root filesystems have separate charges.
[Fly billing](https://fly.io/docs/about/billing/)

## Configuration for speed and efficiency

| Work | CPU | RAM | Reason |
| --- | --- | --- | --- |
| Checkout/command smoke | Shared, 1 vCPU | 1 GB; 2 GB when history calls for it | Observed successful smoke peak below 630 MiB |
| Builds, tests, lint, typecheck | Performance, 2 vCPU | 4 GB | Sustained CPU; measured peaks up to about 3.4 GiB |
| Browser checks | Performance, 2 vCPU | 4 GB | Measured successful browser peak about 2.1 GiB |
| Larger browser history | Performance, 4 vCPU | 8 GB | Existing bounded sizing escalation |

Performance CPUs avoid shared-CPU burst depletion for sustained commands.
These are workload-informed defaults, not a benchmark proving universal optimality.
[Fly CPU guidance](https://fly.io/docs/machines/cpu-performance/)

The reconcile interval changes from 15 seconds to 5 seconds. Three launches per
pass remain paced at least 1.1 seconds apart. This improves nominal queue admission
and result collection delay; actual throughput depends on API latency and workload.
An empty queue causes no provider polling. The launch batch is not a concurrency cap.
[Fly API limits](https://fly.io/docs/machines/api/working-with-machines-api/#rate-limits)

Budgets remain $0.25 per job, $3 daily and $40 monthly for estimated compute.
Storage, egress and inference are not included in those reservations.

## Removed code

The database inventory showed only `poll` jobs and zero legacy callback jobs.
Removed the callback endpoint, proxy bypass, token/update protocol and their tests.
Database migrations and existing job history remain intact.

Removed the unused server LLM runtime module and duplicate placement/budget engine
(including its obsolete three-worker fixture). Admission/reservation remains the
single owner of placement, capacity and budgets.

Removed worker LLM execution, branch publishing and the unused shell entrypoint.
Workers now reject all non-command runtimes before checkout. The REST admission
boundary retains old runtime names only to return an explicit uncommissioned-runtime
response to old clients; current MCP discovery advertises command execution only.

## Session activation

Status now reports `capacity.max_workers`, global occupied/available slots,
`launch_batch_size`, and `reconcile_interval_ms`. Workspace/session activity remains
scoped separately. All already-connected MCP clients receive the updated backend
response on their next request. Cached tool lists can use the CLI immediately:

```sh
node /Users/tylerdevries/Dev/mission-control/scripts/mc-fly.cjs status
```

Tell active agents to read `~/.agents/skills/_shared/fly-command-contract.md` and
`~/.agents/skills/_shared/architect-swarm-policy.md`, then use `mc_submit_fly_leaf`
or the same CLI's `submit /absolute/path/to/payload.json` command. Preserve stable
request/session IDs; never duplicate a remotely owned leaf locally.

The Codex task-management connector returned `Transport closed`, so this audit
could not inject context into other live conversations. Their shared Fly jobs are
visible through Mission Control, and the user was given a pasteable context message.

## Validation

- 44 focused controller tests, 37 worker tests and 9 CLI contract tests passed.
- Timing/capacity tests rerun after the five-second scheduling change.
- Focused ESLint clean; production compilation, TypeScript and artifact checks passed.
- r12 core/browser images built and published as immutable digests; Chromium render
  smoke passed in the r12 browser image. Package layers are unchanged from r11;
  this cleanup does not claim a new vulnerability scan or elimination of its findings.
- Controller promoted; all four actual MCP configurations report 25 slots and a 5000 ms interval.
- Private r12 canary task 47: succeeded. Evidence: `~/.agents/state/mc-cleanup-canary-final.json`.

## Remaining boundaries

The Mac must remain available to coordinate work. Remote results have a bounded
retention lease. Existing workers finish on the image with which they launched;
restarting agents or replacing running Machines is not required for future jobs.

A 25-Machine paid load test has not been run. The 25-reservation/26th-queued boundary
is covered by tests. Future repositories still require enrollment and supported
package scripts. Command failures in repository tests are not repaired by increasing
Machine count. No claim is made that every project test suite passes.
