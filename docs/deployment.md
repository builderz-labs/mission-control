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

## Content Security Policy (CSP)

Mission Control now uses **per-request CSP nonces** for inline bootstrapping scripts (Next.js runtime + `next-themes`).
This removes the need for `unsafe-inline` in both `script-src` and `style-src`.

### How it works

- `src/proxy.ts` generates a fresh nonce for each request
- The nonce is injected into the request header as `x-nonce`
- `src/app/layout.tsx` reads that header and passes the nonce to `ThemeProvider`
- The CSP header is emitted with `script-src 'nonce-...'` and `style-src 'nonce-...'`

### Operator notes

- You do **not** need to regenerate static hashes during normal deployment (nonces are generated at runtime)
- If you terminate TLS/proxy in front of Mission Control, forward headers unchanged
- To verify policy in production:

```bash
curl -s -I https://your-mission-control-host/login | grep -i "content-security-policy\|x-nonce"
```

### Regenerating CSP hashes (only if you add static inline code)

Mission Control is nonce-based by default, but if you intentionally whitelist a fixed inline snippet with hashes:

> The script lives in the repo at `~/projects/openclaw-jstratil/builder-control/scripts/csp-hash.mjs`. Run the following from that checkout so the hashes align with the project files:
>
> ```bash
> cd ~/projects/openclaw-jstratil/builder-control
> ```

```bash
pnpm csp:hash --text "console.log('inline snippet')"
# or
pnpm csp:hash ./path/to/inline-snippet.js
```

Use the printed value (for example `sha256-...`) in your CSP `script-src`/`style-src` directive.
Any change to the snippet content requires generating a new hash.

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTH_USER` | Yes | `admin` | Admin username (seeded on first run) |
| `AUTH_PASS` | Yes | - | Admin password |
| `API_KEY` | Yes | - | API key for headless access |
| `MISSION_CONTROL_SERVICE_API_KEY` | No | `API_KEY` | Dedicated API key used by the Mission Control worker (`pnpm worker notifications|heartbeat`) |
| `PORT` | No | `3005` (direct) / `3000` (Docker) | Server port |
| `OPENCLAW_HOME` | No | - | Path to OpenClaw installation |
| `MC_ALLOWED_HOSTS` | No | `localhost,127.0.0.1` | Allowed hosts in production |

## Service-Mode Auth for Cron/Systemd Worker

`pnpm worker notifications` and `pnpm worker heartbeat` call protected API endpoints.
For unattended runs (cron/systemd), export a service API key so requests include `x-api-key`:

```bash
export MISSION_CONTROL_URL=http://127.0.0.1:3005
export MISSION_CONTROL_SERVICE_API_KEY=your-long-random-key

pnpm worker notifications --daemon --interval 60
# or
pnpm worker heartbeat --daemon --interval 900
```

If `MISSION_CONTROL_SERVICE_API_KEY` is unset, worker commands fall back to `API_KEY`.
Worker commands fail fast when Mission Control responds with non-200 (including 401).

### Why standalone worker (not Next.js API route)?

These jobs are periodic background tasks and do not require inbound HTTP triggers. A standalone TypeScript worker is easier to run under cron/systemd, keeps scheduling concerns outside request/response lifecycles, and can still reuse Mission Control API contracts with structured logging/error handling.

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
