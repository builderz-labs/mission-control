# Mission Control — Ops, Deploy & Self-Healing

This is the runbook for keeping the EPL Mission Control deployment (`mc.str-agents.com`,
VPS `204.168.227.30`, `/opt/mission-control`, Docker project `mission-control`) running
reliably without hand-holding.

## Deploy (always from a committed ref)

**Never** run `docker compose up -d --build` against the working tree — that ships
uncommitted edits and breaks the link between what's running and what's in git.

```bash
ssh vps
cd /opt/mission-control
scripts/deploy-vps.sh origin/main      # or any ref/sha
```

What it does:
- `git archive <ref>` exports **only the committed tree** to `/opt/mc-build/<sha>` — the
  dirty working tree is physically excluded from the image.
- carries gitignored runtime files (`.env`) into the build context.
- `docker compose -p mission-control …` pins the project name so the **same data volume**
  (`mission-control_mc-data`) and container are reused — the SQLite DB is never orphaned.
- records the deployed sha in `.deployed-sha` and appends to `.deploy-log`.
- a failed build leaves the **old container running** (no downtime).

## Self-healing & monitoring (systemd timers)

Install once (idempotent, safe to re-run):

```bash
ssh vps "cd /opt/mission-control && scripts/install-ops.sh"
```

| Timer | Cadence | Does |
|---|---|---|
| `mc-watchdog` | every 5 min | container down → recreate; HTTP 000/5xx → restart (after one grace retry); WAL ≥ 256 MB → `wal_checkpoint(TRUNCATE)` |
| `mc-drift-check` | daily 06:30 UTC | alerts if `.deployed-sha` ≠ `origin/main` or the tree is dirty |
| `mc-digest` | daily 07:05 UTC | reads the DB read-only → task throughput, failure rate, stuck tasks, DB/WAL size |

Logs live in `/opt/mc-ops/` (`watchdog.log`, `drift-check.log`, `digest-YYYY-MM-DD.txt`).

Check status:
```bash
systemctl list-timers 'mc-*'
tail -f /opt/mc-ops/watchdog.log
```

## Optional Slack alerts (no secrets in git)

Alerting is opt-in. Drop a webhook into `/opt/mc-ops/ops.env`:

```bash
# /opt/mc-ops/ops.env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ
# MC_PORT=4000
# MC_WAL_MAX_MB=256
```

The timers load it automatically. Without it, everything still runs and logs to file —
it just doesn't post to Slack.

## What heals itself vs. what needs a human

- **Container crash / hang / unhealthy** → watchdog restarts it (≤5 min).
- **Host reboot** → Docker `restart: unless-stopped` brings MC back automatically.
- **Oversized WAL** → watchdog checkpoints it.
- **Host fully down / network outage** → needs the host back (Hetzner). The watchdog runs
  *on* the host, so it can't fix a dead host; once the host returns, MC auto-starts.
- **DB corruption** → restore from `/app/.data/backups/` (nightly) — manual.

## Stability facts (verified 23 Jun 2026)

The DB already runs WAL mode with a busy timeout — no `SQLITE_BUSY` in production:
`journal_mode=wal`, `busy_timeout=5000`, `synchronous=NORMAL`, `wal_autocheckpoint=1000`.
The connector-keys page writes to `OPENCLAW_STATE_DIR=/app/.data/openclaw` on the writable
volume (the container rootfs is read-only; only the volume + tmpfs are writable).
