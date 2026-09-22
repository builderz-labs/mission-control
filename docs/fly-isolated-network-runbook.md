# Runbook: move the worker pool onto an isolated private network

Workers currently run in `mission-control-workers-tyler`, which sits on the
organization's default 6PN network. Measured on 2026-09-06, that network is shared
with `mission-control-control-tyler`, `actz-demo`, `actz-may` and
`stillpoint-obsidian-cortex` — every one of them under the prefix
`fdaa:75:746e:a7b`. A worker can therefore address unrelated applications. Moving
the pool to its own network closes that path; a probe Machine in
`mission-control-workers-iso-tyler` on `--network mc-workers-iso` came up under
`fdaa:c2:758b:a7b`, could not resolve `actz-demo.internal`,
`mission-control-control-tyler.internal` or `mission-control-workers-tyler.internal`,
and timed out with no route to a default-6PN address.

## Read this before touching anything

**The app is what isolates, not the setting.** Machines are created at
`POST /apps/{MC_FLY_WORKER_APP}/machines` and the request carries no network
field, so a Machine inherits whatever network its app was created with.
`MC_FLY_WORKER_NETWORK` is read in exactly one place — the `worker_network` field
of `flyCapacity()` — and is a label. Setting it without moving the app makes
`mc_fly_status` report an isolation that does not exist. Set both, in the order
below, or set neither.

**Keep the old app in `MC_FLY_IMAGE_APPS`.** `isFlyWorkerImageRef()` accepts an
image only when it matches `registry.fly.io/<app>@sha256:<64 hex>` for an app in
`flyImageApps()`, which is `MC_FLY_WORKER_APP` plus `MC_FLY_IMAGE_APPS`. The core
image is published under `mission-control-workers-tyler`, and the pinned digest in
`MC_FLY_CORE_IMAGE` must not change during a network move. Drop the old app from
that list and every launch fails its image check. No image copy is needed — the
probe Machine pulled that same image from the new app.

`FLY_API_TOKEN` is a restricted secret in Doppler `mission-control/prd`. An agent
session cannot read it, so `doppler run -- flyctl` fails outside your own shell.
Every step below is yours to run.

## 1. Create the isolated app

```bash
doppler run --project mission-control --config prd -- \
  flyctl apps create mission-control-workers-iso-tyler --network mc-workers-iso
```

Add `--org <name>` if your flyctl default is not the organization that holds
`mission-control-workers-tyler`; the new app must be in the same one, or the
pinned core image is in a different registry namespace.

Confirm the network took, and that the app holds no secrets of its own — the
controller injects every credential per Machine:

```bash
doppler run --project mission-control --config prd -- flyctl secrets list -a mission-control-workers-iso-tyler
```

## 2. Set the three keys together

```bash
doppler secrets set --project mission-control --config prd \
  MC_FLY_WORKER_APP=mission-control-workers-iso-tyler \
  MC_FLY_IMAGE_APPS=mission-control-workers-tyler \
  MC_FLY_WORKER_NETWORK=mc-workers-iso
```

## 3. Restart on an idle window

The durable queue is one SQLite database and a restart interrupts nothing that is
already running, but jobs mid-flight would be re-reconciled against a worker app
that no longer holds them. Wait for zero:

```bash
sqlite3 .data/mission-control.db "SELECT COUNT(*) FROM fly_worker_jobs WHERE state IN ('creating','running','cleaning')"
```

Then restart, and let the reaper in `scripts/start-standalone.sh` clear the prior
controller:

```bash
launchctl kickstart -k gui/$(id -u)/com.tylerdevries.mission-control
```

## 4. Verify, in this order

```bash
lsof -t -nP -iTCP:3000 -sTCP:LISTEN                 # exactly one pid
lsof -t -- .data/mission-control.db                 # the same pid, alone
ps -axo pid=,ppid=,command= | awk '$2==1' | grep next-server   # must print nothing
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health
```

A PPID-1 `next-server` means the reaper missed a controller and two schedulers are
sharing the queue; kill the orphan before going further.

Then confirm the pool reports the new app, and commission a real canary — the
readiness field is configuration-only and proves nothing about connectivity:

- `mc_fly_status` should show `worker_app: mission-control-workers-iso-tyler`,
  `worker_network: mc-workers-iso`, `ready: true`, `issues: []`.
- Submit one `mc_submit_fly_leaf` smoke job at a pushed SHA and watch it reach
  `succeeded` with the worker destroyed.

## Rollback

Nothing is destroyed by this move, so reverting is three keys and a restart:

```bash
doppler secrets set --project mission-control --config prd \
  MC_FLY_WORKER_APP=mission-control-workers-tyler
doppler secrets delete --yes --project mission-control --config prd \
  MC_FLY_IMAGE_APPS MC_FLY_WORKER_NETWORK
launchctl kickstart -k gui/$(id -u)/com.tylerdevries.mission-control
```

Leave `mission-control-workers-iso-tyler` in place while any job still records it
as its `worker_app`; `FlyMachinesClient.withApp()` exists so a retired app can
still be reconciled, and destroying it early strands those rows.
