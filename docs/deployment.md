# Deployment Guide

## Prerequisites

- **Node.js** >= 20 (LTS recommended)
- **pnpm** (installed via corepack: `corepack enable && corepack prepare pnpm@latest --activate`)

### Ubuntu / Debian

`better-sqlite3` requires native compilation tools:

```bash
sudo apt-get update
sudo apt-get install -y python3 make g++
```

### macOS

Xcode command line tools are required:

```bash
xcode-select --install
```

## Quick Start (Development)

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Open http://localhost:3000. Login with `AUTH_USER` / `AUTH_PASS` from your `.env.local`.

## Production (Direct)

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Do not use `pnpm dev` for uptime-sensitive deployments. `pnpm dev` is for local development only.

The `pnpm start` script binds to `0.0.0.0:3005`. Override with:

```bash
PORT=3000 pnpm start
```

**Important:** The production build bundles platform-specific native binaries. You must run `pnpm install` and `pnpm build` on the same OS and architecture as the target server. A build created on macOS will not work on Linux.

### Production (PM2)

Use PM2 if you want automatic restart without Docker:

```bash
pnpm install --frozen-lockfile
pnpm build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

The included `ecosystem.config.cjs`:
- runs `next start` in production mode
- restarts on crashes
- applies exponential backoff between restart attempts
- restarts if the process exceeds 1 GB of memory

Use `pm2 logs mission-control` to inspect failures, and monitor `GET /api/health` for uptime checks.

### Production (systemd)

For Linux servers managed by systemd, use `ops/templates/mission-control.service` as a starting point.

Typical install flow:

```bash
sudo useradd --system --create-home --home-dir /opt/mission-control mission-control
sudo mkdir -p /etc/mission-control
sudo cp ops/templates/mission-control.service /etc/systemd/system/mission-control.service
sudo cp .env /etc/mission-control/mission-control.env
sudo systemctl daemon-reload
sudo systemctl enable --now mission-control
```

Before enabling the unit:
- set `WorkingDirectory` in the service file to your deploy path
- confirm `pnpm` is available in the service `PATH`, or replace `ExecStart` with the absolute `pnpm` path from `which pnpm`
- keep `GET /api/health` as the liveness probe instead of `/api/status`

## Production (Docker)

```bash
docker build -t mission-control .
docker run -p 3000:3000 \
  -v mission-control-data:/app/.data \
  -e AUTH_USER=admin \
  -e AUTH_PASS=your-secure-password \
  -e API_KEY=your-api-key \
  mission-control
```

The Docker image:
- Builds from `node:20-slim` with multi-stage build
- Compiles `better-sqlite3` natively inside the container (Linux x64)
- Uses Next.js standalone output for minimal image size
- Runs as non-root user `nextjs`
- Exposes port 3000 (override with `-e PORT=8080`)
- Uses `GET /api/health` for the container health check

### Persistent Data

SQLite database is stored in `/app/.data/` inside the container. Mount a volume to persist data across restarts:

```bash
docker run -v /path/to/data:/app/.data ...
```

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTH_USER` | Yes | `admin` | Admin username (seeded on first run) |
| `AUTH_PASS` | Yes | - | Admin password |
| `API_KEY` | Yes | - | API key for headless access |
| `PORT` | No | `3005` (direct) / `3000` (Docker) | Server port |
| `OPENCLAW_HOME` | No | - | Path to OpenClaw installation |
| `MC_ALLOWED_HOSTS` | No | `localhost,127.0.0.1` | Allowed hosts in production |

## Troubleshooting

### "Module not found: better-sqlite3"

Native compilation failed. On Ubuntu/Debian:
```bash
sudo apt-get install -y python3 make g++
rm -rf node_modules
pnpm install
```

### "Invalid ELF header" or "Mach-O" errors

The native binary was compiled on a different platform. Rebuild:
```bash
rm -rf node_modules .next
pnpm install
pnpm build
```

### Database locked errors

Ensure only one instance is running against the same `.data/` directory. SQLite uses WAL mode but does not support multiple writers.

### Health checks always fail

Use `GET /api/health` for container probes and external monitoring. Do not point liveness checks at `/api/status`, because `/api/status` is an authenticated operational endpoint rather than a public health probe.

### Process keeps stopping

If you are not using Docker:
- use PM2 with `ecosystem.config.cjs`, or
- install the systemd unit from `ops/templates/mission-control.service`

Both configurations restart Mission Control automatically after crashes instead of leaving the API down until someone logs in and starts it manually.
