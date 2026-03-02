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
