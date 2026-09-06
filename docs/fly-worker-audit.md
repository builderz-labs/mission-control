# Consolidated Fly implementation audit — 2026-09-05

This report replaces earlier callback/r3/r4 readiness claims. Self-review was performed by the active agent; this is not independent review.

## Current verdict

Source integration has materially improved, but Fly is **not commissioned for the proposed 500-task run**. The running standalone backend was observed serving HTML instead of the new Fly API, and Doppler denied restricted `mission-control/prd` secrets twice during this continuation. No production Machines were created or destroyed, no image was built/pushed, and no live canary or invoice measurement was performed here.

Canonical repository: `/Users/tylerdevries/Dev/mission-control`. Consolidation retained the native client under `apps/desktop` and one backend on 3000. User WIP, local-only history, stashes and existing live DB were preserved. Source work does not mean the running process was upgraded.

## Repairs integrated

- Durable, scoped, idempotent admission; global transactional concurrency and budget reservations.
- Command-only polled worker protocol with immutable app-scoped images, exact Git SHA, isolated branch/checkout, bounded checks and process groups.
- Unknown create outcomes remain owned; no duplicate local fallback. Cleanup now requires a successful absence observation, not just a DELETE response.
- Queue deadline, bounded retry, idempotent queued cancellation, cumulative per-submission budget across attempts.
- Forward migration 062 for queue expiry/resource peaks; already-applied 061 is unchanged.
- Reconciliation isolated from slow scan/dispatch loops; normal scheduler cadence restored from 15s to 60s. Idle queues skip provider requests.
- Sizing uses historical peaks, per-core normalized CPU and memory headroom. Admission and reservation share the same history/price logic.
- Strict MCP non-JSON rejection, bounded read retry, stable mutation request IDs and safe cancellation contracts.
- Mac health probes the actual data volume; host CPU uses CPU-time deltas rather than labeling load average as utilization.
- Flowchart with live polling, job table, honest stale/missing states, official Fly logo, and session-scoped chat worker/cost badge.
- OpenAPI submit/status/cancel operations now match route coverage. Legacy docs and environment examples updated.

## Verification in this continuation

- 33 Node worker/MCP tests passed, including real local Git fixtures and process timeout/cleanup checks.
- 46 targeted integrated Vitest tests passed across 10 files, including cumulative budgets, HTTP authorization/payload boundaries, scoped activity and host CPU sampling.
- Full TypeScript check passed after fixing two missing test-fixture result fields.
- Focused ESLint passed with zero warnings after replacing the internal anchor with Next Link.
- API contract parity passed: 280 route operations, 271 OpenAPI operations, existing ignore policy retained.
- The global Claude context hook passed piped-cwd, dirty-tree and offload-required assertions. The currently running MCP registration still lacks the new session filter/cancel contract until reconnected.
- Final read-only live DB check: migration 061 applied, 062 not applied, no Fly submissions or worker jobs. This is not a provider fleet or billing inventory.
- Chrome verification reached the Mission Control sign-in page; no new UI/browser success is claimed. Sign-in and the new backend build are still required.
- No actual provider load/chaos test, new Docker image validation, deployed browser e2e, or live client canary has passed in this continuation.

## Remaining release gates (ordered)

1. **Required authority:** approved Doppler credential with restricted-secret access. Current authentication is denied; no bypass attempted.
2. **Image commissioning:** build/publish current polled AMD64 images, scan dependencies, verify registry digests and regional prices. Older worker images are not valid substitutes.
   The Docker CLI reports version 29.7.2, but its daemon socket was unavailable during the final check; Docker must be available before operator image commissioning.
3. **Backend promotion:** isolated production build, artifact verification, DB backup, controlled restart of the single canonical backend, migration 062, then reconnect MCP clients. Do not overwrite the running artifact during a build.
4. **Real canary:** pinned approved repository SHA; verify admission, worker telemetry/result, exact revision, task review, confirmed absence and cost. Verify this from the active Claude session, not only a separate test client.
5. **Live failure drills:** network partition, API 429/capacity denial, delayed create, cleanup denial, process crash and TTL. Unit simulations exist; actual cloud resilience is not yet demonstrated.
6. **Broad release checks:** full regression, isolated browser e2e and narrow/desktop visual checks against the newly built source. The old standalone build cannot validate new routes/UI.
7. **Billing truth:** compare estimates to Fly invoices; egress/storage/build costs are outside the compute governor. No observed provider-cost figure is available.
8. **Client coverage:** verify each MCP registration and tool reload. Closed desktop chats cannot be globally intercepted; the custom live badge exists only inside Mission Control UI.

## Improvements/deferred gaps

- No evidence justifies preprovisioning 20–30 Machines. Canary 1, then global cap 6, zero idle remains the recommendation.
- Large core jobs beyond the approved 4GB class are declined when history exceeds safe headroom; add priced classes only after measured need.
- Runtime/cost history is not yet a statistically validated autosizer; cold-start, p95 throughput, setup amortization and invoice optimization need real samples.
- No stopped-pool leasing, regional failover, dependency DAG, cross-host HA or per-class quota scheduler. These are deliberate scope limits, not hidden completeness claims.
- Out-of-band/orphan Machines not represented in the local DB require operator inventory. The reconciler must not destroy unrelated Machines speculatively.
- Existing callback compatibility routes/helpers remain for historical rows; new submissions cannot use them. Remove them in a separate migration after confirming no legacy consumers. The old cloud-controller `fly.toml` is archival only.
- Separate consolidation work reported dependency advisories. No blanket dependency upgrade or deletion of user/runtime caches was performed in this audit; release scanning remains mandatory.

The detailed configuration and client steps are in `docs/fly-agent-workers.md`; capacity and cost assumptions are in `docs/fly-scale-architecture.md`.
