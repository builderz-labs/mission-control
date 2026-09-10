# Mission Control Fly audit — 2026-09-06

## Architecture and operating limits

The two Fly apps serve different roles. `mission-control-workers-tyler` holds ephemeral command workers. `mission-control-control-tyler` retains a stopped controller Machine and its 3 GB volume. The canonical scheduler is the local launchd service on port 3000; the cloud controller is not a synchronized replica or automatic failover. Keep the Mac running for scheduling and result collection. Do not enable a second scheduler against the same worker pool with a separate database.

Shared capacity is **25 reserved/running workers**, with transactional admission and a queue for excess jobs. It is not a requirement to keep 25 idle Machines. Workers start on demand and are destroyed after results or failures are collected. Compute budgets remain $0.25/job, $3/day and $40/month; estimates exclude inference, storage, and egress. Controller storage may still incur charges while its Machine is stopped.

## Findings and repairs

| Gap | Repair / evidence |
| --- | --- |
| Doppler authentication and restricted configuration | Scoped read-only service token, protected 0600 storage, environment injection, `--no-fallback`; startup loads Doppler after dotenv. |
| Shared agent access | All four actual Claude/Codex/Kimi/Grok registrations handshake with the same 52-tool MCP server and ready backend. No provider inference was invoked. |
| Existing sessions with stale tool lists | `scripts/mc-fly.cjs` calls the same MCP handlers, with the same validation, ownership, budgets and idempotency. No LLM restart is required to invoke this CLI. |
| Capacity uncertainty | Admission test reserves 25 slots, queues number 26, then admits it after release. Fly API independently observed four concurrent Machines. No 25-Machine paid load test was performed. |
| Historical failures mislabeled as fleet outage | Telemetry retains failure counts while deriving current fleet health from readiness and current bottlenecks. |
| False zero CPU/memory | Worker sampler supports Fly cgroup v1 and cgroup v2; absent measurements remain null. Fly v1 counters were independently observed. |
| Browser smoke did not render | Browser smoke now launches Chromium and verifies DOM content. Explicit bounded `test:e2e` is exposed across API, MCP and worker schemas. |
| Browser cache permissions | Non-root writable browser cache reuses existing browser layers via symlinks. |
| Native dependency setup failure | Added Python/compiler toolchain and bounded, redacted package error diagnostics. Remote browser retry succeeded after installation and an actual Chromium render; worker destroyed. |
| Worker image hygiene | Immutable image digests, pinned package managers, locked fixes for bundled dependencies, non-root execution, bounded process groups and cleanup. Unused browser media packages removed. |

## Session scope

The same Fly **command leaves** are available to Claude, Codex, Kimi and Grok sessions, including existing sessions through the CLI bridge:

```sh
node /Users/tylerdevries/Dev/mission-control/scripts/mc-fly.cjs status
node /Users/tylerdevries/Dev/mission-control/scripts/mc-fly.cjs submit /absolute/leaf.json
```

This does not increase native LLM subagent slots in an already running host. Codex saved concurrency is 25, but the current host exposes four slots and cannot hot-reload that limit. Kimi/Grok have no verified common `subagent.max-parallel` setting; invented settings were not added. Cloud-hosted LLM inference across all four providers is not commissioned; it requires distinct runtime support, authentication and inference budgets.

## Verification evidence

- Exact approved revision: `acee1364524b1b015d50760c34a516aaf73aa4e4` in `https://github.com/tylerdevries22-afk/mission-control.git`.
- Original successful leaf: task 20, `2a8fda72747c46339d11e6c7389dec16`. Replay returned the same result without launching another worker.
- Queued cancellation: task 21, `d88e8a2d466441329e90ee8f440b3aa8`; ownership released and replay safe.
- Intentional command failure: task 22, `99e1220dda8e44bb8bcfcc66118eaa2c`; failure retained and worker destroyed.
- Concurrent run: tasks 23–26, four provider-labeled synthetic requests sharing one swarm ID; three core jobs succeeded. Browser task 23 failed dependency setup and was cleaned up. These labels test queue correlation, not execution by four native LLM processes.
- Both final images passed actual non-root npm ci/pnpm frozen-offline package installation. Final browser image passed a local Chromium launch/render test.
- Worker and CLI final suite: 42 tests passed. 24 focused backend capacity/protocol tests, zero-warning focused lint, production TypeScript build, standalone artifact checks and migration rehearsal passed.
- All four configured client registrations pass initialize, tools/list and Fly status. Grok native MCP doctor also passed; Kimi doctor validated its configuration.

Private local evidence is under `/Users/tylerdevries/.agents/state/`, including `mc-fly-r7-concurrent-evidence.json`, `mc-provider-registration-evidence.json`, `mc-fly-final-worker-tests.log`, and `mc-worker-images-20260906/`.

## Initial r9 live result

At the end of r9 commissioning, the API reported ready with no issues; telemetry is healthy, capacity 25, active/queued/reserved counts zero, and no bottlenecks. The independent Fly API confirms zero worker Machines. Total estimated audit compute is **$0.01644552** (about 1.65 cents); historical failures remain visible.

- Browser task 27 / submission `6085cb8e35454fe59b58c47ef598fd91`: pnpm frozen install, Playwright Chromium setup and real DOM render passed at the approved SHA; 293 metered seconds, $0.00700856 estimated compute. Machine `80e90d6a159598` destroyed. Final memory 1,799,643,136 bytes and CPU 62.41%; live samples prove cgroup v1 reporting.
- Core task 28 / submission `683ba44acc6540a08320223a026ce61e`: smoke passed at the same SHA, 55 metered seconds, $0.000121 estimated compute. Machine `8ee321b7333098` destroyed. Final memory 208,027,648 bytes and CPU 26.2%.
- Both leaves were submitted through the CLI bridge, sharing the same session/swarm and exact MCP admission handlers.
- Final evidence: `mc-fly-final-status.json`, `mc-fly-final-telemetry.json`, `mc-fly-final-provider.json`, `mc-fly-r9-live-evidence.json` under the private state directory.

Initial r9 immutable images (superseded by the recovery/access release):

- MC_FLY_CORE_IMAGE: `registry.fly.io/mission-control-workers-tyler@sha256:327d7a978d3c3b9206807dcc216eac4a8ffe5b2cae5d8805178e95195b48eb2c`
- MC_FLY_BROWSER_IMAGE: `registry.fly.io/mission-control-workers-tyler@sha256:8ac721ca3947347606c1666119331b9429c37bae1d8b16bd243205cae67c0e3a`

## Image scan scope

Both final r9 image scans report 5 critical and 108 high findings attributed to Ubuntu source package `linux`, introduced by `linux-libc-dev` development headers required for native builds. These are retained scanner findings, not a zero-vulnerability claim. Ubuntu identifies this binary package as [Linux kernel headers for development](https://launchpad.net/ubuntu/noble/+package/linux-libc-dev). The image contains no bootable kernel or kernel modules; this scan does not establish the patch status of Fly's separately supplied runtime kernel. The browser scan completed on retry after its first indexing attempt timed out. Final remote outcomes are recorded above.

## Recovery

The scoped Doppler token is `mission-control-local-workers-20260906`, stored at `/Users/tylerdevries/.agents/state/mission-control-doppler-service-token` with mode 0600. Revoke/rotate through Doppler; never copy its value into reports or command arguments. Existing repository allowlists and credentials were preserved.

Previous backend artifacts are retained at `.next.rollback-20260906`, `/Users/tylerdevries/.agents/state/mc-backend-before-gap-20260906`, and `/Users/tylerdevries/.agents/state/mc-backend-before-metrics-20260906`. Pre-promotion DB rehearsal backup is `/Users/tylerdevries/.agents/state/mc-release-20260906-110837/pre-promotion.db`. Configuration backups are under `/Users/tylerdevries/.agents/backups/fly-concurrency-20260906T165413Z/`. Existing work is preserved; concurrent repository integration is tracked separately. Drain active ownership before rollback or scheduler replacement.

## Recovery and global repository release

See [the hardening report](fly-hardening-2026-09-06.md) for scheduler recovery, the common swarm/Ruflo contract, all-provider rules and global repository enrollment. The r10 recovery canary (task34, submission `29834d3cd0434c3f8eb672ae94e0bcc1`) passed at the pinned revision; Machine `811d196ce69d18` was destroyed. Estimated compute was $0.00017759.

All 39 current owner repositories are enrolled, including 26 private repositories whose individual read-only SSH credentials passed authentication. Global access means one controller and pool; it does not grant every worker all repository keys or prove every project build.
