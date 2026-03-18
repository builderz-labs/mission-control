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

## Production (Standalone)

Use this for bare-metal deployments that run Next's standalone server directly.
This path is preferred over ad hoc `node .next/standalone/server.js` because it
syncs `.next/static` and `public/` into the standalone bundle before launch.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start:standalone
```

For a full in-place update on the target host:

```bash
BRANCH=fix/refactor PORT=3000 pnpm deploy:standalone
```

What `deploy:standalone` does:
- fetches and fast-forwards the requested branch
- reinstalls dependencies with the lockfile
- rebuilds from a clean `.next/`
- stops the old process bound to the target port
- starts the standalone server through `scripts/start-standalone.sh`
- verifies that the rendered login page references a CSS asset and that the CSS is served as `text/css`

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

### Behind Traefik (HTTPS)

If Traefik is already running on the host in Docker, use the Traefik overlay to expose Mission Control at a domain (e.g. `https://mc.thelaljis.com/`):

1. Ensure the Mission Control container can join the same Docker network as Traefik. If that network is not named `traefik`, set it:
   ```bash
   export TRAEFIK_NETWORK=traefik_default   # or whatever your Traefik stack created
   ```
2. Optional: set domain and cert resolver:
   ```bash
   export MC_DOMAIN=mc.thelaljis.com
   export TRAEFIK_CERT_RESOLVER=le         # Let's Encrypt (default)
   ```
3. Up with the overlay:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d
   ```

Traefik will route `Host(`mc.thelaljis.com`)` to the mission-control service on port 3000 and terminate TLS. The overlay sets `MC_BASE_URL`, `MC_ALLOWED_HOSTS`, and `MC_COOKIE_SECURE` for correct behavior behind the proxy.

**If you already have a route for mc.thelaljis.com** (e.g. pointing to `http://host.docker.internal:3002`), update it so the backend is the Mission Control container on the shared network instead:

- **Backend URL:** `http://mission-control:3000` (Docker service name; Traefik and mission-control must be on the same network).
- **Do not use:** `http://host.docker.internal:3002` (that bypasses the container and uses a host port).

You can either rely on the overlay’s Docker labels (remove the manual route so Traefik discovers the service from the container), or use a file-based dynamic config: see `traefik-mc.example.yaml` in the repo for a router + service snippet you can merge into your Traefik config.

**Static assets:** Ensure the reverse proxy passes `/_next/static/*` and `/_next/image/*` through to the app unchanged. If those requests return 500 or a non-JS MIME type (e.g. `text/plain`), the app will fail to load; do not rewrite or strip the path for static assets.

### Hermes gateway and Sync Config in Docker

To use **Sync Config** (sync agents from the Hermes gateway config) when Mission Control runs in Docker:

1. Mount the host Hermes home so the container can read `gateway.json` (and optional workspace paths). In `docker-compose.yml`:
   ```yaml
   volumes:
     - ${HERMES_HOME:-$HOME/.hermes}:/run/hermes:ro
   environment:
     - HERMES_HOME=/run/hermes
   ```
2. Ensure the gateway is reachable from the container (e.g. `HERMES_GATEWAY_HOST=host-gateway` and `extra_hosts: ["host-gateway:host-gateway"]` so the host's gateway port is reachable).

Without `HERMES_HOME`, Sync Config completes without error (no ENOENT); with it, agents are read from `gateway.json` and synced into the MC database.

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTH_USER` | Yes | `admin` | Admin username (seeded on first run) |
| `AUTH_PASS` | Yes | - | Admin password |
| `AUTH_PASS_B64` | No | - | Base64-encoded admin password (overrides `AUTH_PASS` if set) |
| `API_KEY` | Yes | - | API key for headless access |
| `PORT` | No | `3005` (direct) / `3000` (Docker) | Server port |
| `HERMES_HOME` | No | `~/.hermes` (or unset in Docker) | Hermes home; `gateway.json` and agent list are read from here. In Docker, set to the mount path (e.g. `/run/hermes`) to enable Sync Config. |
| `HERMES_API_SERVER_PORT` | No | `8642` | Hermes OpenAI-compatible API server port (used for GET /health when HERMES_HOME is set). |
| `HERMES_API_SERVER_HOST` | No | same as gateway host | API server bind host for health checks. |
| `API_SERVER_KEY` / `HERMES_API_SERVER_KEY` | No | - | Bearer token for Hermes API server (port 8642). When set, Mission Control sends `Authorization: Bearer <key>` on health/status probes. |
| `OPENCLAW_HOME` | No | - | Path to OpenClaw installation (legacy) |
| `MC_ALLOWED_HOSTS` | No | `localhost,127.0.0.1` | Allowed hosts in production |

## Troubleshooting

### "Module not found: better-sqlite3"

Native compilation failed. On Ubuntu/Debian:
```bash
sudo apt-get install -y python3 make g++
rm -rf node_modules
pnpm install
```

### AUTH_PASS with "#" is not working

In dotenv files, `#` starts a comment unless the value is quoted.

Use one of these:
- `AUTH_PASS="my#password"`
- `AUTH_PASS_B64=$(echo -n 'my#password' | base64)`

### "pnpm-lock.yaml not found" during Docker build

If your deployment context omits `pnpm-lock.yaml`, Docker build now falls back to
`pnpm install --no-frozen-lockfile`.

For reproducible builds, include `pnpm-lock.yaml` in the build context.

### "Invalid ELF header" or "Mach-O" errors

The native binary was compiled on a different platform. Rebuild:
```bash
rm -rf node_modules .next
pnpm install
pnpm build
```

### Database locked errors

Ensure only one instance is running against the same `.data/` directory. SQLite uses WAL mode but does not support multiple writers.

### "Gateway error: origin not allowed"

Your gateway is rejecting the Mission Control browser origin. Add the Control UI origin
to your gateway config allowlist, for example:

```json
{
  "gateway": {
    "controlUi": {
      "allowedOrigins": ["http://YOUR_HOST:3000"]
    }
  }
}
```

Then restart the gateway and reconnect from Mission Control.

### Hermes API server (health / monitoring)

Hermes can expose an OpenAI-compatible HTTP API on port **8642** (default). Mission Control uses it for health checks when `HERMES_HOME` is set (or when `HERMES_API_SERVER_PORT` is set). If the gateway is configured with a key:

```bash
export API_SERVER_ENABLED=true
export API_SERVER_KEY="your-secret-key-here"
export API_SERVER_PORT="8642"
hermes gateway restart
```

then set the same key for Mission Control so probes succeed:

```bash
export API_SERVER_KEY="your-secret-key-here"
# or HERMES_API_SERVER_KEY
```

Mission Control will send `Authorization: Bearer <key>` on `GET /health` (and on control port requests when `GATEWAY_TOKEN` or gateway.json auth is set).

**Note:** In Hermes, the gateway is the API server on **8642** (HTTP/SSE only). Port **18789** is OpenClaw’s WebSocket control port; nothing runs there in a Hermes-only setup. Mission Control treats 8642 as reachable for the Gateways panel and health checks but does not open a WebSocket to it (Hermes has no WebSocket control channel). Live gateway streams in the UI require OpenClaw or a future Hermes WebSocket endpoint.

### "Gateways panel not enabled" / "Configure a gateway to enable this panel"

The Gateways panel is shown only when Mission Control can reach the gateway (TCP port open). You need **both** sides configured.

**On the Hermes server** (so something is listening for MC to probe):

- **Option A — API server (recommended):** Enable the HTTP API so it listens on port 8642 (or your chosen port):
  ```bash
  export API_SERVER_ENABLED=true
  export API_SERVER_PORT="8642"
  # Optional if you use auth:
  export API_SERVER_KEY="your-secret-key"
  hermes gateway restart   # or however you start the Hermes gateway
  ```
  Ensure the process binds to an address Mission Control can reach (e.g. `0.0.0.0` or the host IP), not only `127.0.0.1`, if MC runs on another machine or in Docker.

- **Option B — OpenClaw control port (18789):** Only relevant when using OpenClaw. Hermes does not use 18789; the Hermes gateway is the API server on 8642. Mission Control will try 8642 first when `HERMES_HOME` or `HERMES_API_SERVER_PORT` is set, then fall back to 18789 for OpenClaw-only setups.

**On Mission Control** (so it knows where to probe):

- Set **host** so MC reaches Hermes (same machine = `127.0.0.1`; other host = that host’s IP or hostname):
  ```bash
  export GATEWAY_HOST=192.168.50.114
  # or HERMES_GATEWAY_HOST / HERMES_API_SERVER_HOST
  ```
- Set **Hermes mode** so MC probes the right port(s):
  ```bash
  export HERMES_HOME=/path/to/.hermes
  # and/or (if not using HERMES_HOME):
  export HERMES_API_SERVER_PORT=8642
  ```
- If the API server uses auth, set the same key: `API_SERVER_KEY` or `HERMES_API_SERVER_KEY`.

**Verify:** Call `GET /api/status?action=ping` (while logged in) to see which host/port is probed and whether TCP (and HTTP, when applicable) succeeds.

### "Gateway error: device identity required"

Device identity signing uses WebCrypto and requires a secure browser context.
Open Mission Control over HTTPS (or localhost), then reconnect.

### "Gateway shows offline on VPS deployment"

Browser WebSocket connections to non-standard ports (like 18789/18790) are often blocked by VPS firewall/provider rules.

Quick option:

```bash
NEXT_PUBLIC_GATEWAY_OPTIONAL=true
```

This runs Mission Control in standalone mode (core features available, live gateway streams unavailable).

Production option: reverse-proxy gateway WebSocket over 443.

nginx example:

```nginx
location /gateway-ws {
  proxy_pass http://127.0.0.1:18789;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 86400;
}
```

Then point UI to:

```bash
NEXT_PUBLIC_GATEWAY_URL=wss://your-domain.com/gateway-ws
```
