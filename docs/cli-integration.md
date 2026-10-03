# Direct CLI Integration

Connect CLI tools (Claude Code, Codex, custom agents) directly to Mission Control without a gateway.

## Quick Start

### 1. Register a connection

```bash
curl -X POST http://localhost:3000/api/connect \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "tool_name": "claude-code",
    "tool_version": "1.0.0",
    "agent_name": "my-agent",
    "agent_role": "developer"
  }'
```

Response:

```json
{
  "connection_id": "550e8400-e29b-41d4-a716-446655440000",
  "agent_id": 42,
  "agent_name": "my-agent",
  "status": "connected",
  "sse_url": "/api/events",
  "heartbeat_url": "/api/agents/42/heartbeat",
  "token_report_url": "/api/tokens"
}
```

- If `agent_name` doesn't exist, it's auto-created.
- Previous connections for the same agent are automatically deactivated.

### 2. Heartbeat loop

Send heartbeats to stay alive and optionally report token usage:

```bash
curl -X POST http://localhost:3000/api/agents/42/heartbeat \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "connection_id": "550e8400-e29b-41d4-a716-446655440000",
    "token_usage": {
      "model": "claude-sonnet-4",
      "inputTokens": 1500,
      "outputTokens": 800
    }
  }'
```

Response includes work items (mentions, assigned tasks, notifications) plus `"token_recorded": true` if usage was reported.

Recommended heartbeat interval: **30 seconds**.

### 3. Subscribe to events (SSE)

```bash
curl -N http://localhost:3000/api/events \
  -H "x-api-key: YOUR_API_KEY"
```

Receives real-time events: task assignments, mentions, agent status changes, etc.

### 4. Report token usage

For bulk token reporting (separate from heartbeat):

```bash
curl -X POST http://localhost:3000/api/tokens \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "model": "claude-sonnet-4",
    "sessionId": "my-agent:chat",
    "inputTokens": 5000,
    "outputTokens": 2000
  }'
```

### 5. Disconnect

```bash
curl -X DELETE http://localhost:3000/api/connect \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"connection_id": "550e8400-e29b-41d4-a716-446655440000"}'
```

Sets the agent offline if no other active connections exist.

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/connect` | operator | Register CLI connection |
| GET | `/api/connect` | viewer | List all connections |
| DELETE | `/api/connect` | operator | Disconnect by connection_id |
| POST | `/api/agents/{id}/heartbeat` | operator | Heartbeat with optional token reporting |
| GET | `/api/events` | viewer | SSE event stream |
| POST | `/api/tokens` | operator | Report token usage |

## Connection Lifecycle

```
POST /api/connect  →  Agent set online
         ↓
  Heartbeat loop (30s)  →  Reports tokens, receives work items
         ↓
DELETE /api/connect  →  Agent set offline (if no other connections)
```

## Notes

- Each agent can only have one active connection at a time. A new `POST /api/connect` for the same agent deactivates the previous connection.
- The `sessionId` format for token reporting follows `{agentName}:{chatType}` convention (e.g., `my-agent:chat`, `my-agent:cli`).
- Heartbeat responses include pending work items (assigned tasks, mentions, notifications) so CLI tools can act on them.

## Host CLI runtimes

Some runtimes are driven by Mission Control instead of calling in: the scheduler launches the
CLI on the same host, reads back its structured result, and records the session for the next run.
Claude Code and Codex CLI work this way, and so does ZCode.

### ZCode

Set an agent's runtime to `ZCode` (Agents → runtime type) and Mission Control dispatches every
task assigned to it through the ZCode CLI:

```bash
zcode --json --mode build --resume sess_… --cwd <workdir> -p <prompt>
```

- **Requirements.** ZCode installed on the same host as Mission Control, and signed in with Z.AI
  OAuth (`zcode login`) — dispatch reuses the operator login, so there is no API key to store.
  If the `zcode` command is not on `PATH`, point `ZCODE_CLI_BIN` at the installed bundle
  (`zcode.cjs`); Mission Control launches bundles through `node` and supplies the built-in
  provider config the bundle expects.
- **Sessions.** ZCode mints its own session ids, so Mission Control captures the id from the first
  successful run and resumes that session for the agent thereafter. Switching the agent away from
  the ZCode runtime retires the captured session. History is read from
  `~/.zcode/cli/rollout/model-io-sess_*.jsonl`, so ZCode sessions appear in the session list and
  transcript viewer without any hook or gateway.
- **Tuning.** `dispatchMode` (agent config or task metadata) selects the permission mode —
  `build`, `edit`, `plan`, or `yolo`; `dispatchCwd` scopes the working directory. Token usage from
  each run is written to the spend dashboard.
- **What is not claimed.** ZCode exposes a tool *deny*list rather than an allowlist, has no
  per-run budget cap flag, and has no attachable PTY, so those capability cells stay off in
  Settings → Agent Runtimes. It also ships as a desktop installer rather than a package, so
  Mission Control detects it but never installs it, and there is no Docker sidecar for it.
