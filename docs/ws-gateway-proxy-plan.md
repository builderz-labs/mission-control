# Plan: WebSocket Gateway Proxy via Custom Next.js Server

**Goal:** Let MC work fully from phone/Tailscale by proxying the OpenClaw gateway WebSocket through the MC Next.js server. Currently the browser tries to connect directly to `ws://host:18789` — which fails from phone because the gateway only listens on loopback (`127.0.0.1`).

---

## How it works today (broken from phone)

```
Phone browser  ──ws://minint-rjdgqcb-1.tail...:18789──▶  ❌ (loopback only)
```

## How it will work after this change

```
Phone browser  ──wss://minint-rjdgqcb-1.tail.../ws-proxy──▶  MC Next.js server (3005)
                                                                      │
                                                               ws://127.0.0.1:18789
                                                                      │
                                                              OpenClaw Gateway ✓
```

---

## Files to change

### 1. `server.js` (new file, project root)

Replace `next start` with a custom server that handles WebSocket upgrade on `/ws-proxy`:

```js
// server.js
const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const httpProxy = require('http-proxy')

const port = parseInt(process.env.PORT || '3000', 10)
const app = next({ dev: false, hostname: '0.0.0.0', port })
const handle = app.getRequestHandler()

// Target: the OpenClaw gateway running locally
const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1'
const GATEWAY_PORT = process.env.OPENCLAW_GATEWAY_PORT || '18789'
const GATEWAY_WS_URL = `ws://${GATEWAY_HOST}:${GATEWAY_PORT}`

const proxy = httpProxy.createProxyServer({
  target: GATEWAY_WS_URL,
  ws: true,
  changeOrigin: false,
})

proxy.on('error', (err, req, res) => {
  console.error('[ws-proxy] error:', err.message)
  if (res && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end('Gateway unavailable')
  }
})

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url || '/', true))
  })

  // Intercept WebSocket upgrades on /ws-proxy
  server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/ws-proxy')) {
      // Strip the /ws-proxy prefix before forwarding
      req.url = req.url.replace('/ws-proxy', '') || '/'
      proxy.ws(req, socket, head)
    } else {
      socket.destroy()
    }
  })

  server.listen(port, '0.0.0.0', () => {
    console.log(`> MC ready on http://0.0.0.0:${port}`)
    console.log(`> WS proxy: /ws-proxy → ${GATEWAY_WS_URL}`)
  })
})
```

### 2. `package.json` — update `start` script

```json
// Before:
"start": "next start --hostname 0.0.0.0 --port ${PORT:-3000}"

// After:
"start": "node server.js"
```

### 3. Install `http-proxy` dependency

```bash
pnpm add http-proxy
pnpm add -D @types/http-proxy
```

### 4. `src/app/[[...panel]]/page.tsx` — update WebSocket URL logic

Replace the current gateway connect block with this logic:

```ts
// Current (direct to gateway port):
const wsUrl = explicitWsUrl || `${gatewayProto}://${gatewayHost}:${gatewayPort}`

// New (use /ws-proxy when running behind MC server):
const isLocalhost = gatewayHost === 'localhost' || gatewayHost === '127.0.0.1'
const wsUrl = explicitWsUrl ||
  (isLocalhost
    ? `${gatewayProto}://${gatewayHost}:${gatewayPort}`       // direct (local dev / desktop)
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws-proxy`  // proxied (phone / Tailscale)
  )
```

This means:
- **Desktop (localhost)**: connects directly to `ws://localhost:18789` as before — no overhead
- **Phone/Tailscale**: connects to `wss://minint-rjdgqcb-1.tail.../ws-proxy` which the custom server forwards to the gateway

Alternatively, add an env var `NEXT_PUBLIC_USE_WS_PROXY=true` to force proxy mode regardless of hostname.

---

## Auth / Security

The gateway requires a bearer token (`NEXT_PUBLIC_GATEWAY_TOKEN`). This token is sent by the MC client in the WebSocket connection headers. The proxy forwards it transparently — no changes needed to auth.

The `/ws-proxy` endpoint is only accessible via the same MC auth surface (Tailscale + MC login). No additional exposure.

---

## PM2 ecosystem update

```js
// ecosystem.config.js (or update pm2 start command)
module.exports = {
  apps: [{
    name: 'mc-v2',
    script: 'server.js',
    cwd: '/home/lucas/.openclaw/workspace/projects/mission-control-v2',
    env: {
      PORT: 3005,
      NODE_ENV: 'production',
    }
  }]
}
```

Or simply update the existing PM2 entry:
```bash
pm2 delete mc-v2
pm2 start server.js --name mc-v2 --cwd /home/lucas/.openclaw/workspace/projects/mission-control-v2 -- 
pm2 save
```

---

## Summary of changes

| File | Change |
|------|--------|
| `server.js` | New — custom HTTP server with WS proxy on `/ws-proxy` |
| `package.json` | `start` script → `node server.js` |
| `package.json` | Add `http-proxy` + `@types/http-proxy` |
| `src/app/[[...panel]]/page.tsx` | WS URL: direct when localhost, proxied when remote |
| PM2 config | Point to `node server.js` instead of `next start` |

Estimated implementation time: ~30 min. No database changes. No gateway config changes.
