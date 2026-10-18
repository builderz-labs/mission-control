# Observe nanobot from Mission Control

The optional bridge subscribes to selected nanobot WebSocket chats and reports
their aggregate activity as one Mission Control agent. It does not require a
nanobot code change, start conversations, dispatch assignments, or control runs.

## Compatibility

This integration targets [HKUDS/nanobot](https://github.com/HKUDS/nanobot), not
other projects sharing the name. Wire shapes were checked against source commit
[`841d2b8`](https://github.com/HKUDS/nanobot/tree/841d2b880ca7a7d21e7b64476799b9af341b1ee0).
It requires the enabled WebSocket channel and its `attach`, `goal_status`,
`turn_end`, `recovery_state`, and `retry_status` events. This is a source-level
compatibility target, not a guarantee for every nanobot release. A build lacking
these events stays `unknown`; connection alone is not evidence of execution.
Tests use a local protocol simulator; a live nanobot deployment must still be
checked before claiming support for a particular release.

An additional transport smoke test against local nanobot source commit
`d4ade8f68010ea4b5fa27b6f2dd36537f91b5610` exercised the real `WebSocketChannel`
with a real Mission Control server: static-token authentication, attachment,
running, normal turn end, blocked goal, and observer shutdown were verified.
The test invoked channel methods directly and made no model requests. It does
not establish full agent-loop compatibility, or verify newer recovery/retry and
turn-ID behavior on that older source version.

A subsequent real-model smoke test on that same source version ran the actual
`AgentLoop` with workspace-scoped `read_file` and `write_file` tools. The model
read three synthetic items from `todo.txt`, wrote `checklist.md`, and completed
three successful model requests. Artifact checks confirmed the three checklist
items, and both the Mission Control API and activity page showed `busy` → `idle`
followed by `offline` after cleanup. This environment's compatible gateway
required non-streaming model calls and omission of the optional `temperature`
parameter for its opaque model alias; these adjustments were limited to the
temporary test provider/channel, not the bridge or user's default config.
Earlier rejected model requests also ended with `idle` on this older nanobot
version: its lifecycle events do not reliably distinguish model failure from a
normal turn end. Always verify the actual task artifact before claiming success.

Only `websocket:` sessions can be observed. Telegram, Discord and other channels
are not covered. Subagent activity, automatic session discovery, task imports,
historical replay and remote cancellation are outside this first integration.

## Run

Use the repository's supported Node version (22+) and install with `pnpm install`.
Start Mission Control and a nanobot gateway with the WebSocket channel enabled.
Use nanobot's configured WebSocket path and **static channel token**. The bridge
does not implement bootstrap-token renewal or trusted-proxy authentication.
Keep the WebSocket endpoint local or use WSS for a remote connection.

Set credentials in your process environment or secret manager, then run:

```bash
export MC_URL=http://127.0.0.1:3000
export MC_API_KEY='<operator API key>'
export MC_AGENT_NAME=nanobot-personal-monitor
export NANOBOT_WS_URL=ws://127.0.0.1:8765/
export NANOBOT_TOKEN='<nanobot static channel token>'
export NANOBOT_CHAT_IDS='chat-a,chat-b'
node scripts/nanobot-bridge.mjs
```

Get chat IDs from your nanobot WebUI session identifiers. For a session key
`websocket:chat-a`, configure `chat-a`. The explicit allowlist accepts 1–32 IDs;
it never subscribes to every session by default. Configure a distinct
`MC_AGENT_NAME` for each installation, and use a name dedicated to this bridge:
the existing registration API reuses an agent with the same workspace and name.
Run only one bridge for that name, so competing processes do not overwrite status.

Check the agent in Mission Control's agent list. The bridge registers it through
`POST /api/agents/register`, persists activity through `PUT /api/agents`, and emits
`nanobot` heartbeat metrics through `POST /api/adapters`. The latter uses the
server's authenticated workspace; credentials are never sent to the other service.
No new server-side network endpoint or database schema is introduced.

## Meaning of the status

| Source observation | Mission Control agent status | Detail retained |
| --- | --- | --- |
| Running turn or waiting for a model retry | `busy` | Counts of `running` and `retrying` chats |
| Turn ended normally / explicit idle | `idle` | `idle` count; no claim that a business goal succeeded |
| Recovery awaits user / goal blocked | `idle` unless another chat is busy or failed | `awaiting_user` count |
| Explicit failure or exhausted retry | `error` unless another chat is busy | `failed` count |
| Connected without execution evidence | `idle` | `unknown` count; this is not confirmed inactivity |
| Disconnected | `offline` | Connection flag; previous execution evidence is discarded |

The persisted last-activity text exposes all counts, including waiting, failures
and unknowns. The heartbeat carries the same counts as live metrics. No UI panel
is added. A normal `turn_end` never marks a Mission Control task complete or
estimates a completion percentage. New running events clear the previous turn's
failure/waiting state; ending events with a different turn ID are ignored.

Updates are coalesced every three seconds, with a heartbeat at least every 30
seconds while delivery succeeds. A failed delivery retries the latest snapshot;
events are not retained as an audit log. The bridge reconnects after five seconds
and reattaches its allowlist. Ping/pong detects a silent broken connection in
roughly 30 seconds. Reconnect resets transient state to unknown and relies on
nanobot's available hydration; there is no complete event replay guarantee.
Ctrl-C/SIGTERM attempts a final offline update. After a crash or SIGKILL, the
last status may remain until Mission Control's normal stale-agent handling runs.

Chat text, reasoning, tool arguments/results, objectives, failure messages and
chat/turn IDs are not forwarded to Mission Control. Only aggregate state counts
are forwarded. Logs omit remote response bodies and credential-bearing URLs.
The `attach` command changes nanobot's connection subscriptions; the observer
does not send user messages, create tasks, cancel work or acknowledge completion.

## Validate

```bash
pnpm exec vitest run src/lib/adapters/__tests__
pnpm quality:gate
```

For a live smoke test, start a turn in one allowlisted WebUI chat, verify `busy`,
wait for the turn to end and verify `idle`, then disconnect the gateway and verify
`offline`. Refresh the agent list to confirm persistence. Test recovery/blocked
states on the nanobot version you deploy. A bridge API key requires operator
access; a viewer key can register but cannot persist or publish status.
