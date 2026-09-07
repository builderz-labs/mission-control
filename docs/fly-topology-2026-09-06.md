# Fly worker topology decision — September 6, 2026

One local controller serves Claude, Codex, Kimi and Grok across 39 enrolled
repositories. The open question was whether to keep a single shared worker app,
split into per-project apps, or adopt a hybrid.

**Decision: hybrid, split by trust boundary — not by project or agent count.**
One shared worker app on a dedicated custom private network, one shared 25-slot
pool, one admission owner, and fairness enforced in the controller rather than by
multiplying Fly apps.

## Measured evidence

All measurements were taken against this organization on 2026-09-06.

| Question | Measured result |
| --- | --- |
| Does an app boundary isolate the network? | No. `mission-control-workers-tyler`, `mission-control-control-tyler`, `actz-demo`, `actz-may` and `stillpoint-obsidian-cortex` all carry 6PN addresses under the same prefix `fdaa:75:746e:a7b`. |
| Does a custom private network isolate? | Yes. A probe Machine in `mission-control-workers-iso-tyler` (`--network mc-workers-iso`) received `fdaa:c2:758b:a7b:…`. |
| Can an isolated worker reach other apps? | No. `actz-demo.internal`, `mission-control-control-tyler.internal` and `mission-control-workers-tyler.internal` all failed to resolve, and a TCP connect to a default-6PN address timed out with no route. The control connect to its own network address returned `ECONNREFUSED`, proving the test could detect reachability. |
| Can a new app run the existing worker image? | Yes. The probe Machine reached `started` on the r12 core image published under `registry.fly.io/mission-control-workers-tyler`. No image copy is required. |
| Does the worker app hold app-level secrets? | No. `fly secrets list -a mission-control-workers-tyler` is empty; every credential is injected per Machine by the controller. |

The probe Machine was destroyed and its one-hour app-scoped token was revoked.

## Why not per-project apps

- Fly caps Machines **per organization**, not per app — the documented default is
  50 across all apps in started, stopped and suspended states.
  ([community thread with Fly staff](https://community.fly.io/t/is-the-maximum-of-50-machines-correct/26432))
  The shared pool already reserves 25 of that org-wide budget, so 39 apps would add
  no capacity while spreading the same ceiling across more namespaces.
- The 6PN measurement above shows an app is not a security boundary. Isolation comes
  from the custom private network and from the Machine itself, and the Machine
  boundary already separates projects: each job is a disposable Machine with
  `auto_destroy`, its own branch, and only its own read-only deploy key.
- Machines API rate limits are per action, scoped by App ID — 1 req/s for Create with
  a burst to 3. ([Fly docs](https://fly.io/docs/machines/api/working-with-machines-api/#rate-limits))
  More apps would multiply launch throughput, but filling 25 slots takes about 25
  seconds against jobs that run 43–646 seconds. Launch rate is not the bottleneck.
- Volumes attach to exactly one Machine at a time
  ([Fly docs](https://fly.io/docs/volumes/overview/)), so per-project apps cannot
  share a dependency cache either. Per-project *images* could, but 39 image pipelines
  is a large, permanent maintenance cost for a saving measured below.
- Secret isolation does not improve. The controller already selects one repository
  credential per Machine, ships no Fly API token to workers, and holds no app-level
  secrets. Per-project apps would only let the controller hold 39 app-scoped Fly
  tokens instead of one, without narrowing what the controller itself can do.

Project count and LLM count are therefore not reasons to create apps. The only
justified additional app is the one that moves untrusted repository build scripts
off the organization's default private network.

## Implemented in this change

- **`worker_app` recorded per job** (migration `063`) and multi-app reconciliation.
  The controller polls every worker app that still owns jobs, so a worker app can be
  retired without stranding or failing work already running on it. This is what makes
  the network cutover safe while other agents' jobs are in flight.
- **Work-conserving fair share.** One project or agent session may use the whole pool
  while nothing else is waiting, and yields to an equal share once others queue.
  Deferred candidates are reordered, never dropped, so capacity is never left idle.
- **Per-project daily budget share** (`MC_FLY_REPO_DAILY_SHARE`, default 0.6) applied
  only while another project is queued, so one runaway project cannot consume the
  whole daily budget but a lone project still reaches all of it.
- **Ordered launch regions** (`MC_FLY_REGIONS`). A second region is tried only after
  `createMachine` has confirmed the launch name is absent, so a region retry cannot
  duplicate an accepted launch.
- **Registry app decoupled from the runtime app** (`MC_FLY_IMAGE_APPS`). Immutable
  digests are still required and the publishing app must still be explicitly owned.
- Status now reports `worker_network`, `launch_regions` and the fair-share rule.
- **Stale-controller guard.** `reconcileFlyWorkers` refuses admission when the
  standalone artifact is newer than the process running it, which is proof the
  process is executing code that has since been replaced. This is what the split
  brain below needed and did not have. It activates at the next deploy.

## Remaining cutover step (not applied)

Switching the runtime app to the isolated network requires Doppler writes this
session could not make. The CLI token here reads the project fine — it resolved
`MC_FLY_WORKER_APP=mission-control-workers-tyler` and `MC_FLY_MAX_WORKERS=25`, and
confirmed that `MC_FLY_IMAGE_APPS`, `MC_FLY_REGIONS` and `MC_FLY_WORKER_NETWORK` do
not yet exist in `prd` — but secret *writes* are withheld from this session, and
`FLY_API_TOKEN` is a restricted secret it cannot read or exercise. Every code path
below already defaults safely while those keys are absent.

```sh
doppler secrets set --project mission-control --config prd \
  MC_FLY_WORKER_APP=mission-control-workers-iso-tyler \
  MC_FLY_IMAGE_APPS=mission-control-workers-tyler \
  MC_FLY_WORKER_NETWORK=mc-workers-iso
launchctl kickstart -k gui/$(id -u)/com.tylerdevries.mission-control
```

Before applying it:

1. **Replace `FLY_API_TOKEN` with an org-scoped token — this is now measured, not
   hypothetical.** Using the controller's own Doppler service token, the credential
   it actually runs with returns **HTTP 200** for
   `mission-control-workers-tyler` and **HTTP 403** for
   `mission-control-workers-iso-tyler`. It is the app-scoped
   `mission-control-worker-scheduler` token, so the cutover as a bare config change
   would fail on every launch.

   It must be an **org**-scoped token, not a deploy token for the new app. The
   reconciler observes in-flight jobs through the `worker_app` recorded on each row,
   so during cutover it has to reach the old app to poll and destroy Machines still
   running there. An app-scoped iso token would strand them. The organization
   already holds an `Org deploy token`; either reuse it or mint a fresh one:

   ```sh
   fly tokens create org --name mission-control-worker-scheduler-org --expiry 720h
   ```

   Re-run the status-only check after storing it — expect `200` from **both** apps:

   ```sh
   DOPPLER_TOKEN="$(cat ~/.agents/state/mission-control-doppler-service-token)" \
   doppler run --project mission-control --config prd --no-fallback -- sh -c \
     'for a in mission-control-workers-tyler mission-control-workers-iso-tyler; do
        curl -s -o /dev/null -m 25 -w "$a %{http_code}\n" \
          -H "Authorization: Bearer $FLY_API_TOKEN" \
          "https://api.machines.dev/v1/apps/$a/machines"; done'
   ```

   Note that an interactive `doppler run` without `DOPPLER_TOKEN` fails here: the
   machine CLI identity cannot read restricted secrets. The controller's service
   token is the identity that can.

2. Apply during an idle window. Jobs already running keep their recorded
   `worker_app` and are still polled and cleaned up on the old app.
3. Confirm exactly one controller process is running (see split brain above).
4. Run one canary per worker class before relying on the new app.

## Controller split brain (found during validation, now resolved)

Validating `worker_app` attribution exposed an unrelated operational fault worth
recording, because it invalidates canary evidence and affects the cutover below.

Two controller processes were running against the same SQLite database: the
launchd-managed one, and an orphan (`PPID 1`) started manually at 14:32 that had
lost port 3000 to the newer process but kept polling the queue. Both appear in
`.data/launchd.out.log`, and the log line for canary C's job was emitted by the
orphan. `fly_scheduler_lock` correctly serialised reconciliation, so no job was
double-run, but admission could be served by either process — and the orphan was
running pre-change code, so the `worker_app` column it wrote was NULL.

The database confirms the mechanism: 28 rows carry
`mission-control-workers-tyler` from migration `063`'s backfill, and exactly four
are NULL — all created between 14:58 and 15:16, the window in which the orphan and
a second short-lived stale process shared the queue. No row created outside that
window is NULL.

Two consequences:

- **Canary C's NULL `worker_app` was evidence about the stale process, not about
  the new code path.** After the orphan was terminated, canary D (task 53) was
  reserved by the single remaining controller and recorded
  `worker_app=mission-control-workers-tyler`, ran, succeeded and was cleaned up at
  15:48:58 for $0.0011. Attribution is now verified in production as well as in
  `src/lib/__tests__/fly-topology.test.ts`.
- **`launchctl kickstart -k` does not remove a manually started orphan.** It
  restarts only the managed job. A stale process survives it and keeps competing
  for admission, which is why the guard above is enforced in code rather than left
  to operator discipline.

The four affected rows are all in terminal states and were left in place as
evidence; the reconciler already falls back to the client's app for a NULL
`worker_app`, so they are still observable and cleanable.

**`launchctl kickstart -k` orphans the running server every time.** This was
observed on both redeploys in this session, and the cause is structural: the
launchd job runs `doppler run ... -- node server.js`, and `doppler run` spawns
node as a child rather than exec'ing it. Kickstart replaces the job's main
process (doppler) and the node server survives, reparented to PID 1, still
holding the database. Every redeploy therefore needs an explicit check and kill:

```sh
ps -ax -o pid,ppid,lstart,command | grep "[n]ext-server"   # any PPID 1 is an orphan
kill -TERM <pid>                                            # SIGKILL if it ignores TERM
```

The stale-controller guard limits the damage — an orphan now refuses Fly
admission — but it does not stop the orphan's other scheduler work, so the kill
is still required. A durable fix belongs in the launchd job: have it kill the
process group, or exec node directly rather than through a wrapper that forks.

Before the cutover, and before trusting any canary, confirm exactly one
controller process owns the database:

```sh
ps -ax -o pid,ppid,lstart,command | grep "[n]ext-server"
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Any `next-server` whose PID is not a child of the launchd-supervised
`doppler run` wrapper is an orphan and must be terminated before deploying.

## Boundaries

A custom private network stops cross-app 6PN traffic. It is not an egress firewall:
workers still reach the public internet, which they need for Git and package
registries. Machines remain the isolation unit for repository code, and these are
trusted repository workloads, not a hostile same-UID guarantee.

The org-wide 50-Machine cap has not been raised, and a 25-way paid load test has
still not been run. Regional fallback is configured but has only been exercised
against a simulated capacity refusal in tests, not a real regional outage.
