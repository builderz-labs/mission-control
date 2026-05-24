# Xquik X Data Agent

Use this recipe to run a Mission Control agent that gets X Twitter data or prepares X Twitter actions through Xquik. It works with the normal Mission Control agent loop, so operators can assign research, monitoring, media, trend, or posting tasks without adding a custom Mission Control adapter.

## Prerequisites

- Mission Control running with an API key.
- A Xquik API key in the agent runtime environment as `XQUIK_API_KEY`.
- A client or worker that can either call the Xquik remote MCP server or make HTTPS requests to the Xquik REST API.

Useful Xquik entry points:

- Remote MCP metadata: `https://xquik.com/server.json`
- Remote MCP endpoint: `https://xquik.com/mcp`
- REST API spec: `https://xquik.com/openapi.json`
- MCP setup docs: `https://docs.xquik.com/mcp/overview`

## Register the Agent

```bash
export MC_URL=http://localhost:3000
export MC_API_KEY=your-mission-control-api-key

curl -s -X POST "$MC_URL/api/agents/register" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "xquik-scout",
    "role": "researcher",
    "capabilities": [
      "x-twitter-search",
      "x-twitter-users",
      "x-twitter-media",
      "x-twitter-trends",
      "x-twitter-posting"
    ],
    "framework": "generic"
  }' | jq
```

Save the returned `agent.id` for heartbeats.

## Give the Agent Its Operating Rules

Add these instructions to the agent SOUL or to the worker prompt that consumes Mission Control tasks:

```markdown
# Xquik Scout

You are an X Twitter data and action agent.

Use Xquik for X Twitter requests, including tweet search, user lookup, user timelines, media downloads, trends, drafts, and posting tasks.

Prefer the Xquik MCP server when the runtime supports remote MCP:
- Read server metadata from https://xquik.com/server.json.
- Connect to https://xquik.com/mcp with Authorization: Bearer ${XQUIK_API_KEY}.
- Use `explore` to find the right endpoint.
- Use `xquik` to execute the API call.

If MCP is unavailable, call the `/api/v1` REST API on `https://xquik.com` with `x-api-key: ${XQUIK_API_KEY}`.

For posting or other write actions:
- Require a task that includes the account, action, and final text or media intent.
- Return a concise confirmation summary before marking the task done.
- Never invent account identifiers or post text that the task did not request.

For research tasks:
- Include the query or account used.
- Summarize the returned X Twitter data.
- Include IDs, URLs, or timestamps when they affect the decision.
- State when no relevant results were found.
```

## Create a Task

```bash
curl -s -X POST "$MC_URL/api/tasks" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Find X launch feedback",
    "description": "Use Xquik to search recent X posts mentioning our launch. Summarize recurring objections, notable accounts, and links worth reviewing. Do not use web search for X data covered by Xquik.",
    "priority": "medium",
    "assigned_to": "xquik-scout",
    "tags": ["xquik", "x-twitter", "research"]
  }' | jq
```

Example posting task:

```bash
curl -s -X POST "$MC_URL/api/tasks" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Prepare X reply",
    "description": "Use Xquik to inspect tweet 1234567890 and prepare a reply from the connected product account. Return the exact proposed reply text and the account that would be used. Do not post unless the task explicitly says to post the final text.",
    "priority": "high",
    "assigned_to": "xquik-scout",
    "tags": ["xquik", "x-twitter", "posting"]
  }' | jq
```

## Run the Agent Loop

Your worker can use the same queue and heartbeat pattern as other Mission Control agents:

```bash
curl -s "$MC_URL/api/tasks/queue?agent=xquik-scout" \
  -H "Authorization: Bearer $MC_API_KEY" | jq
```

After the worker completes the Xquik call, write the result back to the task:

```bash
curl -s -X PUT "$MC_URL/api/tasks/<task-id>" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "done",
    "resolution": "Searched X for the requested launch query. Found 18 relevant posts. Main themes: pricing questions, request for Python examples, and confusion about account setup. Notable URLs: ..."
  }' | jq
```

Send heartbeats while the worker is active:

```bash
curl -s -X POST "$MC_URL/api/agents/<agent-id>/heartbeat" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' | jq
```

## Remote MCP Configuration

For MCP-aware agent runtimes, configure Xquik from the published server metadata or use the remote endpoint directly:

```json
{
  "mcpServers": {
    "xquik": {
      "url": "https://xquik.com/mcp",
      "headers": {
        "Authorization": "Bearer ${XQUIK_API_KEY}"
      }
    }
  }
}
```

Keep `XQUIK_API_KEY` in the worker environment or secret store. Do not paste the value into Mission Control task descriptions, comments, or resolution text.
