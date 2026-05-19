# Mission Control — Deploy Runbook

**App:** Attach OS (Mission Control)
**Stack:** Next.js 16, SQLite, Docker Compose
**Access model:** Private — Tailscale MagicDNS only (no public port exposed)
**Last updated:** 2026-05-19

---

## 1. Prerequisites (one-time setup)

These steps are required before any deploy. Complete them once per Droplet.

| Requirement | Minimum | Recommended |
|---|---|---|
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| RAM | 2 GB | 4 GB (builds are memory-intensive) |
| Disk | 10 GB free | 20 GB free |
| Docker | 24.x + | Latest stable |
| Docker Compose | v2 (plugin) | v2 |
| Tailscale | Connected to tailnet | MagicDNS enabled |
| Git access | HTTPS token or SSH key | SSH key |

### 1.1 Install Docker (if not present)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect
```

### 1.2 Install Tailscale (if not present)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

### 1.3 Verify Tailscale MagicDNS

```bash
tailscale status
# Confirm this machine appears in the tailnet and MagicDNS is active
```

Domain pattern: `https://mission-control.<YOUR-TAILNET>.ts.net`

---

## 2. First Deploy

Run these steps on the Droplet as the deploy user (not root).

```bash
# 1. Clone the repo
git clone git@github.com:fsalazar-glitch/attach-mission-control.git /opt/attach-os
cd /opt/attach-os

# 2. Configure environment
cp .env.example .env
nano .env   # Fill in all required variables (see Section 7)

# 3. Create data and backups directories
mkdir -p /opt/attach-os/data
mkdir -p /opt/attach-os/backups

# 4. Build and start the container
docker compose -f docker-compose.attach.yml up -d --build

# 5. Expose via Tailscale HTTPS (no public port opened)
tailscale serve --bg https://mission-control.tail-xyz.ts.net 3000

# 6. Verify the service is healthy
docker compose -f docker-compose.attach.yml ps
docker compose -f docker-compose.attach.yml logs -f attach-os
```

After a successful first deploy, test access from another Tailscale-connected device:

```bash
curl -sf https://mission-control.<YOUR-TAILNET>.ts.net/api/status | jq .
```

---

## 3. Update Deploy (Rolling)

Use this for standard releases. Causes a brief restart (~10–30 s).

```bash
cd /opt/attach-os

# 1. Pull latest code
git pull origin main

# 2. Rebuild and restart only the app container (leaves other services running)
docker compose -f docker-compose.attach.yml up -d --build --no-deps attach-os

# 3. Confirm the container came back up
docker compose -f docker-compose.attach.yml ps
```

Check the logs if the container does not reach `running` status within 60 s:

```bash
docker compose -f docker-compose.attach.yml logs --tail=100 attach-os
```

---

## 4. Rollback (to Previous Image)

Use this when an update breaks the app and you need to revert quickly.

```bash
cd /opt/attach-os

# 1. Identify the last known-good commit
git log --oneline -10

# 2. Bring down the current containers
docker compose -f docker-compose.attach.yml down

# 3. Check out the previous SHA
git checkout <previous-sha>

# 4. Rebuild from the rolled-back code
docker compose -f docker-compose.attach.yml up -d --build

# 5. Re-expose via Tailscale if serve config was lost
tailscale serve --bg https://mission-control.tail-xyz.ts.net 3000
```

To return to the latest commit after confirming the rollback:

```bash
git checkout main
git pull origin main
docker compose -f docker-compose.attach.yml up -d --build --no-deps attach-os
```

---

## 5. Backup SQLite DB

### 5.1 Manual backup

```bash
# Create a timestamped backup inside the container
docker exec attach-os-attach-os-1 \
  sqlite3 /app/data/mission-control.db \
  ".backup /app/data/backup-$(date +%Y%m%d).db"

# Copy the backup file to the host
docker cp attach-os-attach-os-1:/app/data/backup-$(date +%Y%m%d).db \
  /opt/attach-os/backups/
```

### 5.2 Automated daily backups (recommended)

Add a cron job on the Droplet:

```bash
crontab -e
```

Append:

```
0 3 * * * docker exec attach-os-attach-os-1 sqlite3 /app/data/mission-control.db ".backup /app/data/backup-$(date +\%Y\%m\%d).db" && docker cp attach-os-attach-os-1:/app/data/backup-$(date +\%Y\%m\%d).db /opt/attach-os/backups/
```

### 5.3 Restore from backup

```bash
# Stop the app first to avoid write conflicts
docker compose -f docker-compose.attach.yml stop attach-os

# Copy the backup file into the container
docker cp /opt/attach-os/backups/backup-YYYYMMDD.db \
  attach-os-attach-os-1:/app/data/mission-control.db

# Restart
docker compose -f docker-compose.attach.yml start attach-os
```

---

## 6. Health Check

Run from any Tailscale-connected machine:

```bash
# Full status JSON
curl -sf https://mission-control.<YOUR-TAILNET>.ts.net/api/status | jq .

# Quick up/down check (exit code 0 = healthy)
curl -sf https://mission-control.<YOUR-TAILNET>.ts.net/api/status > /dev/null && echo "UP" || echo "DOWN"
```

Expected response shape:

```json
{
  "status": "ok",
  "version": "x.y.z",
  "db": "connected"
}
```

---

## 7. Required .env Variables

Copy `.env.example` to `.env` and fill in all values before first deploy.

| Variable | Description | Example |
|---|---|---|
| `DATABASE_PATH` | SQLite file path inside container | `/app/data/mission-control.db` |
| `NEXTAUTH_URL` | Public URL via Tailscale HTTPS | `https://mission-control.YOUR-TAILNET.ts.net` |
| `NEXTAUTH_SECRET` | Random 32-char secret — generate with `openssl rand -base64 32` | *(do not commit)* |
| `NODE_ENV` | Always `production` for Droplet deploys | `production` |

Generate `NEXTAUTH_SECRET` on the Droplet:

```bash
openssl rand -base64 32
```

---

## 8. Troubleshooting

### Port 3000 not accessible via Tailscale

```bash
# 1. Check container is running
docker compose -f docker-compose.attach.yml ps

# 2. Check Tailscale serve configuration
tailscale serve status

# 3. Re-apply serve if config was lost (e.g. after reboot)
tailscale serve --bg https://mission-control.tail-xyz.ts.net 3000

# 4. Confirm port 3000 is bound inside the container
docker exec attach-os-attach-os-1 ss -tlnp | grep 3000
```

Note: Port 3000 should NOT be open in `ufw` or the DO Firewall. All access is routed through Tailscale.

### DB migration errors on startup

```bash
# 1. Check logs for the specific migration error
docker compose -f docker-compose.attach.yml logs attach-os | grep -i migration

# 2. Take a backup before any destructive action (see Section 5.1)

# 3. If the DB is corrupt or migrations are stuck, delete and re-run
docker compose -f docker-compose.attach.yml stop attach-os
docker exec attach-os-attach-os-1 rm /app/data/mission-control.db || true
docker compose -f docker-compose.attach.yml start attach-os
# Migrations will re-run on fresh start — data will be lost; restore from backup if needed
```

### Build OOM (out of memory)

Symptom: `docker compose up --build` hangs or exits with code 137.

```bash
# Option A: Constrain build memory (for 2 GB Droplets)
docker buildx build --memory 1g -t attach-os:local .

# Option B: Upgrade the Droplet to 4 GB RAM
# DO Console → Resize → 4 GB General Purpose

# Option C: Build locally and push to a registry, then pull on the Droplet
# (avoids running the build on the Droplet entirely)
```

### Container keeps restarting

```bash
docker compose -f docker-compose.attach.yml logs --tail=50 attach-os
# Look for uncaught exceptions, missing env vars, or failed DB connections
```

Common causes:
- Missing or incorrect `.env` variable (especially `NEXTAUTH_SECRET` or `DATABASE_PATH`)
- `data/` directory not writable by the container user
- SQLite file locked by a previous unclean shutdown

Fix for permissions:

```bash
sudo chown -R 1001:1001 /opt/attach-os/data
```

---

## 9. Notes

- This runbook targets the single-Droplet setup with Tailscale private access. For multi-instance or public-facing deploys, a load balancer and external DB (Postgres) will be needed — revisit this runbook at that point.
- Tailscale `serve` config persists across reboots on most distributions, but verify with `tailscale serve status` after any Droplet restart.
- Keep backups older than 30 days pruned to avoid filling the Droplet disk:
  ```bash
  find /opt/attach-os/backups -name "backup-*.db" -mtime +30 -delete
  ```
