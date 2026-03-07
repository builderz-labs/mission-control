# Mission Control Management Skill

Manage a running Mission Control instance programmatically.

## API Endpoints

All endpoints require authentication via `x-api-key` header or session cookie.

### Health Check

```bash
# Quick health status
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/status?action=health

# Response: { "status": "healthy", "version": "1.3.0", "checks": [...] }
```

Possible statuses: `healthy`, `degraded`, `unhealthy`

### System Overview

```bash
# Full system status (memory, disk, sessions, processes)
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/status?action=overview
```

### Diagnostics (Admin Only)

```bash
# Comprehensive diagnostics including security posture
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/diagnostics

# Response includes:
# - system: node version, platform, memory, docker detection
# - security: score (0-100) with individual checks
# - database: size, WAL mode, migration version
# - gateway: configured, reachable, host/port
# - agents: total count, by status
# - retention: configured retention policies
```

### Check for Updates

```bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/releases/check

# Response: { "updateAvailable": true, "currentVersion": "1.3.0", "latestVersion": "1.4.0", ... }
```

### Trigger Update

```bash
# Apply available update (bare-metal only; Docker returns instructions)
curl -X POST -H "x-api-key: $API_KEY" http://localhost:3000/api/releases/update
```

### Database Backup

```bash
curl -X POST -H "x-api-key: $API_KEY" http://localhost:3000/api/backup
```

### Agent Management

```bash
# List agents
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/agents

# Register an agent
curl -X POST -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent", "type": "openclaw"}' \
  http://localhost:3000/api/agents
```

## Station Doctor

For local diagnostics without API access:

```bash
bash scripts/station-doctor.sh
```

Checks: Docker health, port availability, disk space, DB integrity, backup age.

## Common Workflows

### Automated Health Monitoring

```bash
# Check health and alert if unhealthy
STATUS=$(curl -sf -H "x-api-key: $API_KEY" http://localhost:3000/api/status?action=health | jq -r '.status')
if [ "$STATUS" != "healthy" ]; then
  echo "ALERT: Mission Control is $STATUS"
fi
```

### Pre-Upgrade Checklist

1. Check for updates: `GET /api/releases/check`
2. Create backup: `POST /api/backup`
3. Run diagnostics: `GET /api/diagnostics` (verify no active tasks)
4. Apply update: `POST /api/releases/update` (or `docker pull` + recreate for Docker)
5. Verify health: `GET /api/status?action=health`
