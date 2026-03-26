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
docker compose up          # with gateway connectivity
docker compose --profile standalone up   # without gateway (standalone mode)
```

Or build and run manually:

```bash
docker build -t mission-control .
docker run -p 3000:3000 \
  -v mission-control-data:/app/.data \
  -e AUTH_USER=admin \
  -e AUTH_PASS=your-secure-password \
  -e API_KEY=your-api-key \
  -e OPENCLAW_GATEWAY_HOST=host.docker.internal \
  --add-host=host.docker.internal:host-gateway \
  mission-control
```

The Docker image:
- Builds from `node:22-slim` with multi-stage build
- Compiles `better-sqlite3` natively inside the container (Linux x64)
- Uses Next.js standalone output for minimal image size
- Runs as non-root user `nextjs`
- Exposes port 3000 (override with `-e PORT=8080`)

### Gateway Connectivity from Docker

MC inside Docker needs to reach the gateway running on the host. There are **two** connections:

1. **Server-side** (MC backend → gateway): Set `OPENCLAW_GATEWAY_HOST=host.docker.internal`.
   Docker Desktop (macOS/Windows) resolves this automatically. On Linux, `docker-compose.yml`
   maps it via `extra_hosts`.

2. **Browser-side** (user's browser → gateway WebSocket): When the gateway host is a
   Docker-internal name (like `host.docker.internal`), MC automatically rewrites the WebSocket
   URL to the browser's own hostname. No extra config needed for local Docker usage.
   For remote access, set `NEXT_PUBLIC_GATEWAY_HOST` to the public hostname.

If your gateway runs in **another container**, put both on the same Docker network and set
`OPENCLAW_GATEWAY_HOST` to the gateway container name.

### Persistent Data

SQLite database is stored in `/app/.data/` inside the container. Mount a volume to persist data across restarts:

```bash
docker run -v /path/to/data:/app/.data ...
```

### Production Hardening

```bash
docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d
```

This adds: JSON logging, strict hostname allowlist, secure cookies, HSTS, internal-only network.

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTH_USER` | Yes | `admin` | Admin username (seeded on first run) |
| `AUTH_PASS` | Yes | - | Admin password |
| `AUTH_PASS_B64` | No | - | Base64-encoded admin password (overrides `AUTH_PASS` if set) |
| `API_KEY` | Yes | - | API key for headless access |
| `PORT` | No | `3005` (direct) / `3000` (Docker) | Server port |
| `OPENCLAW_HOME` | No | - | Legacy: parent home directory containing `.openclaw/`. Use `OPENCLAW_STATE_DIR` instead (see note below) |
| `OPENCLAW_STATE_DIR` | No | `~/.openclaw` | Exact path to the OpenClaw state directory. Preferred over `OPENCLAW_HOME` — avoids double-nesting when the path already ends in `.openclaw` |
| `MISSION_CONTROL_DATA_DIR` | No | `.data/` | Directory for all Mission Control data files (DB, tokens, etc.). Use an absolute path with the standalone server to survive rebuilds. |
| `MC_ALLOWED_HOSTS` | No | `localhost,127.0.0.1` | Allowed hosts in production |

> **Note — `OPENCLAW_HOME` vs `OPENCLAW_STATE_DIR`**
>
> Mission Control supports two env vars for locating OpenClaw:
>
> - `OPENCLAW_HOME` — treated as the *parent* home directory; `.openclaw` is appended automatically.
>   Setting `OPENCLAW_HOME=/root/.openclaw` will resolve to `/root/.openclaw/.openclaw` (**double-nesting bug**).
> - `OPENCLAW_STATE_DIR` — treated as the *exact* state directory path. Always prefer this.
>
> **Recommended `.env` for a standard install:**
> ```env
> OPENCLAW_STATE_DIR=/root/.openclaw
> MISSION_CONTROL_DATA_DIR=/absolute/path/to/.data
> ```
> Using an absolute path for `MISSION_CONTROL_DATA_DIR` ensures your
> database and data survive `npm run build` / standalone server rebuilds.

## Kubernetes Sidecar Deployment

When running Mission Control alongside a gateway as containers in the same pod (sidecar pattern), agents are not discovered via the filesystem. Instead, use the gateway's agent registration API.

### Architecture

```
┌──────────────── Pod ────────────────┐
│  ┌─────────┐     ┌───────────────┐  │
│  │   MC    │◄───►│   Gateway     │  │
│  │ :3000   │     │   :18789      │  │
│  └─────────┘     └───────────────┘  │
│       ▲                  ▲          │
│       │ localhost         │          │
│       └──────────────────┘          │
└─────────────────────────────────────┘
```

### Required Configuration

**Environment variables** for the MC container:

```bash
AUTH_USER=admin
AUTH_PASS=<secure-password>
API_KEY=<your-api-key>
OPENCLAW_GATEWAY_HOST=127.0.0.1
NEXT_PUBLIC_GATEWAY_PORT=18789
```

### Agent Registration

The gateway must register its agents with MC on startup. Include the `agents` array in the gateway registration request:

```bash
curl -X POST http://localhost:3000/api/gateways \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "sidecar-gateway",
    "host": "127.0.0.1",
    "port": 18789,
    "is_primary": true,
    "agents": [
      { "name": "developer-1", "role": "developer" },
      { "name": "researcher-1", "role": "researcher" }
    ]
  }'
```

To update the agent list on reconnect, use `PUT /api/gateways` with the same `agents` field.

Alternatively, each agent can register itself via the direct connection endpoint:

```bash
curl -X POST http://localhost:3000/api/connect \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "openclaw-gateway",
    "agent_name": "developer-1",
    "agent_role": "developer"
  }'
```

### Health Checks

Agents must send heartbeats to stay visible:

```bash
curl http://localhost:3000/api/agents/<agent-id>/heartbeat \
  -H "Authorization: Bearer <API_KEY>"
```

Without heartbeats, agents will be marked offline after 10 minutes (configurable via `general.agent_timeout_minutes` setting).

## Troubleshooting

### "Internal server error" on login / NODE_MODULE_VERSION mismatch

`better-sqlite3` is a native addon compiled for a specific Node.js version.
If you switch Node versions (e.g. via nvm), the compiled binary won't load.

```bash
pnpm rebuild better-sqlite3
```

The health endpoint (`/api/status?action=health`) will report this error explicitly.

### "Module not found: better-sqlite3"

Native compilation failed. On Ubuntu/Debian:
```bash
sudo apt-get install -y python3 make g++
rm -rf node_modules
pnpm install
```

### Docker: gateway unreachable / WebSocket not connecting

**Checklist:**

1. Verify the gateway is reachable from inside the container:
   ```bash
   docker exec mission-control curl -s http://host.docker.internal:18789
   ```

2. Check env vars are set:
   ```bash
   docker exec mission-control env | grep -i gateway
   ```
   You should see `OPENCLAW_GATEWAY_HOST=host.docker.internal`.

3. If using a **mounted `~/.openclaw`** directory, the `openclaw.json` inside may have
   `gateway.host = "127.0.0.1"` — this is the host's loopback, not reachable from the
   container. Environment variables take precedence over `openclaw.json`, so set
   `OPENCLAW_GATEWAY_HOST=host.docker.internal` in your `.env` or docker-compose.

4. **Browser WebSocket**: MC automatically rewrites Docker-internal hostnames
   (`host.docker.internal`, `host-gateway`) to the browser's hostname. If the browser
   still can't connect, set `NEXT_PUBLIC_GATEWAY_HOST` to a hostname your browser can reach.

5. **Linux-specific**: `host.docker.internal` requires Docker 20.10+. The `extra_hosts`
   entry in `docker-compose.yml` handles this. If using `docker run` directly, add
   `--add-host=host.docker.internal:host-gateway`.

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

Mission Control now retries common reverse-proxy websocket paths (`/gateway-ws`, `/gw`) automatically when root-path handshake fails, but setting `NEXT_PUBLIC_GATEWAY_URL` is still recommended for deterministic production behavior.

## Next Steps

Once deployed, set up your agents and orchestration:

- **[Quickstart](quickstart.md)** — Register your first agent and complete a task in 5 minutes
- **[Agent Setup](agent-setup.md)** — SOUL personalities, heartbeats, config sync, agent sources
- **[Orchestration Patterns](orchestration.md)** — Auto-dispatch, quality review, multi-agent workflows
- **[CLI Reference](cli-agent-control.md)** — Full CLI command list for headless/scripted usage
