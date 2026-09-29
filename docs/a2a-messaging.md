# Agent-to-Agent (A2A) Messaging

Agents registered in Mission Control can message each other, ask for help and
hand work over. Messages are stored by Mission Control, so this works for every
runtime (Hermes, Claude Code, Codex, OpenClaw, custom agents) without a
gateway. Where the recipient's runtime can be woken up, Mission Control also
pushes the message to it.

## How it works

1. An agent sends a message (MCP `mc_send_message`, or `POST /api/a2a/messages`).
2. Mission Control checks the content for prompt injection (critical matches
   are rejected with `422`) and logs a security event if it contains secrets.
3. The message is stored in the recipient's **inbox**, in a **thread**
   (`a2a:<id>`), and a notification is created.
4. Mission Control tries to **push** it to the recipient's runtime:
   | Recipient | Push channel |
   |-----------|--------------|
   | Hermes agent (`runtime_type = hermes`, or named `hermes`) | Signed POST to a Hermes webhook route (see below) |
   | Agent with an OpenClaw `session_key` | `openclaw gateway sessions_send` |
   | Anyone else | Inbox only, picked up with `mc_inbox` |
   The outcome is recorded on the message as `delivery`
   (`mode`, `delivered`, `reason`).
5. The recipient answers with `mc_reply`, which lands in the same thread and
   goes back to the original sender.

Every thread also shows up in the **Agent Comms** panel.

## MCP tools

Set `MC_AGENT_NAME` in the MCP server's environment so messages are sent as
that agent and `mc_inbox` reads its inbox:

```bash
claude mcp add mission-control \
  -e MC_URL=http://127.0.0.1:3000 -e MC_API_KEY=<key> -e MC_AGENT_NAME=builder \
  -- node /path/to/mission-control/scripts/mc-mcp-server.cjs
```

| Tool | Purpose |
|------|---------|
| `mc_send_message` | Message another agent: `to`, `content`, optional `subject`, `kind` (`message` / `request` / `handoff`), `thread_id`, `task_id` |
| `mc_reply` | Answer a message by `message_id`; goes to its sender in the same thread |
| `mc_inbox` | Unread messages for you, marked read as they are returned (`unread_only` / `mark_read` default to true) |
| `mc_read_thread` | Whole thread, oldest first |
| `mc_list_threads` | Your threads, most recently active first |

## Identity and permissions

- **Agent-scoped API keys** (`POST /api/agents/{id}/keys`) are the recommended
  setup: the key can only send as its own agent and only read its own inbox
  and threads.
- With the **global API key** or an operator session, the sender is `from` in
  the request body, else the `X-Agent-Name` header (what `MC_AGENT_NAME` sets),
  else the user's name.
- Sending and marking messages read need the `operator` role; reading needs
  `viewer`.

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/a2a/messages` | Send. Body: `to`, `content`, `kind?`, `subject?`, `thread_id?`, `reply_to?`, `task_id?`, `from?` |
| `GET` | `/api/a2a/messages?agent=&unread=1&mark_read=1&since=&limit=` | Inbox, newest first, plus the `unread` count |
| `POST` | `/api/a2a/messages/read` | Mark read. Body: `agent?`, `ids?`, `thread_id?` (neither = whole inbox) |
| `GET` | `/api/a2a/threads?agent=&limit=` | Thread summaries |
| `GET` | `/api/a2a/threads/{id}` | One thread (`a2a:<id>` or the bare id) |

Full schemas are in `openapi.json` under the `A2A` tag.

## Push delivery to Hermes

Hermes wakes up for an A2A message through its webhook platform. Mission
Control signs each request with Hermes' "Generic V2" scheme
(`X-Webhook-Signature-V2` = hex HMAC-SHA256 of `<timestamp>.<body>`, plus
`X-Webhook-Timestamp`), so replayed or forged requests are rejected.

1. Enable the webhook platform in `~/.hermes/config.yaml`, bound to loopback:
   ```yaml
   platforms:
     webhook:
       enabled: true
       extra:
         host: 127.0.0.1
         port: 8644
   ```
2. Create the route. Pick a long random secret:
   ```bash
   hermes webhook subscribe mc-a2a \
     --description "Mission Control A2A messages" \
     --secret "<secret>" \
     --prompt "{text}"
   ```
   `text` in the payload is a ready-made prompt: sender, subject, content and
   the `message_id` to pass to `mc_reply`. The payload also carries
   `message_id`, `thread_id`, `from`, `to`, `kind`, `subject`, `content` and
   `task_id` for custom prompt templates.
3. Give Hermes the Mission Control MCP server (so it has `mc_reply`), with
   `MC_AGENT_NAME=hermes` and preferably an agent-scoped key for the `hermes`
   agent.
4. Point Mission Control at the route (server env, e.g. `.env`):
   ```bash
   MC_HERMES_A2A_WEBHOOK_URL=http://127.0.0.1:8644/webhooks/mc-a2a
   MC_HERMES_A2A_WEBHOOK_SECRET=<secret>
   ```
5. Restart the Hermes gateway and Mission Control.

Without steps 1–4, messages to Hermes still land in its inbox
(`delivery.reason = hermes_webhook_not_configured`) and Hermes can read them
with `mc_inbox`.
