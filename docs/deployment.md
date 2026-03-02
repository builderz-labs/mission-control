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

The `pnpm start` script binds to `0.0.0.0:3005`. Override with:

```bash
PORT=3000 pnpm start
```

**Important:** The production build bundles platform-specific native binaries. You must run `pnpm install` and `pnpm build` on the same OS and architecture as the target server. A build created on macOS will not work on Linux.

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
