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

The r11 images add OpenSSH to the recovery release. The r11 core scan completed with 5 critical/108 high findings attributed to Linux development headers. The r11 browser scan failed indexing after two bounded eight-minute attempts; its current complete scan is unverified. Earlier r9 browser findings remain documented, not represented as a current clean scan. Fly runtime-kernel patch status remains unassessed. See the commissioning report for scope.

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

## Global repository access

Using the authenticated GitHub CLI, enrollment inventoried 39 non-archived repositories under `tylerdevries22-afk`: 13 public and 26 private. All 26 private repositories passed `git ls-remote` with their individual read-only deploy keys and pinned GitHub host keys. No personal GitHub token was copied to workers. GitHub documents that [deploy keys are repository-scoped and can be read-only](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys).

`MC_FLY_GIT_SSH_KEYS_JSON` is a Doppler-held controller registry. Reservation selects only the matching repository's key; the complete registry never enters the worker configuration. Keys are materialized in a mode-0600 temporary file only around Git operations and removed before package scripts. These are trusted repository workloads, not a hostile same-UID isolation guarantee. Deploy keys do not expire automatically; revoke them through each repository's deploy-key settings and update Doppler during rotation.

The global allowlist preserves prior entries. `MC_FLY_PRIVATE_REPOS` makes missing private credentials decline before paid launch. Public checkout remains credential-free. Five prior Stillpoint jobs failed because no worker Git credential existed; their historical failures remain intact and were not duplicated.

For an additional authorized project:

```sh
python3 scripts/mc-fly-enroll.py --repository OWNER/REPO
```

For the owner's complete current inventory, use `--owner OWNER`. The command is resumable, checks observed keys after an ambiguous create response, refuses write-enabled keys, checkpoints successful enrollment and keeps credential values out of arguments/logs. Apply changed controller configuration during an idle window. The shared contract and all four agent rule projections describe this flow.

Access enrollment does not prove every repository's build. Supported command leaves still require a clean pushed SHA, supported package setup and declared checks; Mac/Xcode and unsupported toolchains remain local according to policy.

## Deployed verification

The production build, TypeScript checks and standalone artifact validation passed. The registry backend was promoted while active/queued counts were zero; all four configured MCP client handshakes remained ready afterward. Final worker suite: 41 passed. Registry/admission suite: 26 passed. Enrollment helper: 3 passed. Focused lint: zero warnings. Browser r11 Chromium launch/render passed locally.

Private Fly canary task38 / submission `b559ebc2b1ab4c008d0bd2ab87a510a6` succeeded at pushed revision `3a6cc91b259ad9ae817ba93c19fe01ad4368ac21` of stillpoint-builders. Its single attempt consumed 134 metered seconds and $0.0002948 estimated compute. Worker `870650a0210008` was destroyed, independently confirmed through Fly API. Machine configuration contained only the matching repository key, with no global registry or Fly API token.

A polling evidence helper timed out during local host load; the final same-handler CLI status confirmed success and cleanup, and the independent provider read confirmed absence. Another session had one worker running at the final snapshot and was left untouched. No global zero-worker claim is made for that snapshot.

Current immutable images:

- MC_FLY_CORE_IMAGE: `registry.fly.io/mission-control-workers-tyler@sha256:20ca9a1352fe5110def9eac1afa3b10f390218185f8ec534df59936b90dd1a7b`
- MC_FLY_BROWSER_IMAGE: `registry.fly.io/mission-control-workers-tyler@sha256:80c3e3247b802509bc4e39f91938e7616079fcec4ca45c61246f312487cd5ebb`

Evidence: `mc-fly-enrollment-evidence.json`, `mc-global-repo-access-evidence.json`, `mc-worker-auth-scope-evidence.json`, `mc-private-canary-final.json`, `mc-global-final-provider.json`, and `mc-provider-registration-evidence.json` under the private state directory. Previous controller artifact: `mc-backend-before-registry-20260906`.
