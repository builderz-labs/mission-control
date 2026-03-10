# Gateway adapters (OpenClaw / NeoBot / custom)

Mission Control now treats the gateway connection as an _adapter_ contract instead of hard-coding OpenClaw-specific logic. This makes it easy to connect new orchestration frameworks (ZeroClaw, NeoBot, custom pipelines) without rewriting the UI or scheduler.

## 1. Configure adapters via environment

Use `MC_GATEWAY_ADAPTERS` to register every gateway you want Mission Control to know about. Each entry describes the WebSocket URL, optional health endpoint, and the protocol `kind`:

```bash
MC_GATEWAY_ADAPTERS='[
  {
    "name": "primary-openclaw",
    "kind": "openclaw",
    "wsUrl": "ws://127.0.0.1:18789",
    "healthUrl": "http://127.0.0.1:18789/",
    "token": "",
    "primary": true
  },
  {
    "name": "neobot-edge",
    "kind": "custom",
    "wsUrl": "wss://neobot.example/ws",
    "healthUrl": "https://neobot.example/health"
  }
]'
```

When `MC_GATEWAY_ADAPTERS` is unset, Mission Control falls back to the legacy `OPENCLAW_GATEWAY_*` vars.

## 2. Client discovery and connection

- The browser fetches `/api/gateway-adapters` (viewer access required) to retrieve the registry exposed by `getGatewayAdaptersFromEnv()`.
- `useWebSocket()` now exposes `connectAdapter()` which accepts a `GatewayAdapterConfig` object, selects the right protocol, and reuses that adapter metadata during reconnects.
- If the adapter request fails, the UI still falls back to the old `NEXT_PUBLIC_GATEWAY_*` host + port.

## 3. Adapter interface (handshake → auth → events)

See `src/lib/gateway-websocket-adapters.ts` for the details of the contract:

| Method | Responsibility |
| ------ | -------------- |
| `connect(url, token?)` | Open the WebSocket and drive the authentication handshake. For OpenClaw this means sending a `connect` request with the Ed25519 device identity, client role/scopes, and optional token. Custom adapters can reuse their own handshake payloads as long as they resolve `GatewayMessage`/`GatewayFrame` schemas.
| `disconnect(code?, reason?)` | Gracefully close the socket when the dashboard switches adapters or the user manually disconnects.
| `send(payload)` | Push commands/events back to the gateway.
| `onFrame(onFrame)` | Receive raw gateway frames if you need to inspect protocol-level events.
| `onMessage(onMessage)` | Receive parsed mission-control events (`session_update`, `log`, etc.).
| `onHeartbeat(onHeartbeat)` | Report latency/pong events so the UI can display a healthy connection.
| `health()` | Return status/latency for scheduler health checks.

Each adapter is responsible for satisfying the handshake → auth → event stream flow required by Mission Control. The OpenClaw adapter handles ping/pong heartbeats, caches device tokens, and directly translates frames to the shared `GatewayMessage` shape.

## 4. Registering a new connector

1. Create a new adapter class that implements `GatewayAdapter`. Pay attention to the handshake: your `connect()` should reach the gateway, prove your identity/auth token, and start emitting frames/messages as Mission Control expects.
2. Update `src/lib/gateway-websocket-adapters.ts` and `createGatewayAdapter()` so the new `kind` string maps to your class (e.g., `if (kind === 'neobot') return new NeoBotAdapter(name)`).
3. Add a `kind` entry to `MC_GATEWAY_ADAPTERS` and point `wsUrl`/`token` at your gateway.
4. Restart Mission Control — the scheduler will start validating the adapter via the `gateway_adapter_health` task and the UI will automatically pick the `primary` adapter from the registry.

Need inspiration? Look at `OpenClawWebSocketAdapter` for a working handshake implementation, then mimic `onMessage`, `onFrame`, and heartbeat handling in your own connector.
## 5. Gateway health history API

Every time Mission Control runs `POST /api/gateways/health` (via the "Probe All" button or the backend scheduler) it now persists the result in `gateway_health_logs`. The new endpoint exposes the most recent 100 entries grouped by gateway so you can inspect stability trends programmatically:

```http
GET /api/gateways/health/history
Accept: application/json
Authorization: <viewer token>
```

```json
{
  "history": [
    {
      "gatewayId": 1,
      "name": "primary",
      "entries": [
        {"status": "online", "latency": 12, "probed_at": 1700000000, "error": null},
        {"status": "offline", "latency": null, "probed_at": 1699999900, "error": "timeout"}
      ]
    }
  ]
}
```

Each `entries` item carries `status` (`online`, `offline`, or `error`), `latency` in milliseconds (when available), the Unix `probed_at` timestamp, and any `error` message. The dashboard now renders a compact sparkline of these dots per gateway so operators can quickly spot repeat failures before rerouting traffic.
