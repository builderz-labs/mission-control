# Handoff briefs

A structured context object one agent/runtime writes when it hands a task to
another — for example, a mobile-reachable agent (Hermes over Telegram) handing
work to Claude Code on your desktop, and Claude Code handing it back when it's
done. This is the answer to a common multi-agent setup problem: the "brain"
(a strong local coding agent) and the "hands" (a mobile-reachable agent) never
share enough context to hand off cleanly.

A handoff brief is not the same thing as the `handoff` chat message type you
may already see in the conversation view — that's a cosmetic marker
(`agent A handed off to agent B`). A brief is the actual payload: what the
task is, what's already been decided, what's next, and what's still open.

## Shape

```json
{
  "from_agent": "hermes",
  "to_agent": "claude-code",
  "task_id": 42,
  "task_summary": "Fix the flaky checkout test",
  "decisions_made": ["reproduced locally, it's a race in the cart mock"],
  "key_context": "Started from a Telegram message at 14:02, see task #42 for the original report.",
  "next_steps": ["patch the mock's timing", "re-run the suite 5x to confirm"],
  "open_questions": ["should the mock be fixed or just made deterministic?"],
  "refs": ["src/tests/checkout.test.ts:88"]
}
```

Only `from_agent` and `task_summary` are required. Everything else defaults
to empty.

## API

- `POST /api/handoffs` — create a brief (requires `operator` role).
- `GET /api/handoffs?to_agent=<name>` — the latest unconsumed brief addressed
  to that agent (optionally `&task_id=<id>` to scope to one task). This is
  what a receiving session should call at startup.
- `GET /api/handoffs?to_agent=<name>&all=true` — full history instead of just
  the latest.
- `POST /api/handoffs/{id}/consume` — mark a brief as read so it isn't
  re-injected into a later session. Idempotent.

Full request/response shapes are in `openapi.json` under the `Handoffs` tag.

## MCP tools

`mc_create_handoff`, `mc_get_handoff`, `mc_consume_handoff` — see
`scripts/mc-mcp-server.cjs`. Any MCP-capable agent (Claude Code, Codex,
Hermes) can create or read a brief without touching the REST API directly.

## Wiring Claude Code to auto-pick-up a brief

Rather than the receiving agent remembering to check for a handoff, wire
`scripts/hooks/handoff-session-start.mjs` as a Claude Code `SessionStart`
hook. It fetches the latest brief addressed to the configured agent name,
prints it to stdout (which Claude Code injects as context), and marks it
consumed:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node /path/to/mission-control/scripts/hooks/handoff-session-start.mjs" }] }
    ]
  }
}
```

Requires `MC_URL`, `MC_API_KEY` (or `MC_AGENT_API_KEY`), and `MC_AGENT_NAME`
in the environment. If any are unset the hook exits quietly with no output.

## Wiring the mobile/hands side

Mission Control doesn't need a new Telegram bridge for this: if you're
already running Hermes/OpenClaw with its Telegram gateway (see the
Channels panel), that transport is already there. The gap this feature
closes is what happens *after* the message arrives — instead of the mobile
agent improvising a summary in the chat, it should call `mc_create_handoff`
(or `POST /api/handoffs`) with a real brief before dispatching to Claude
Code, and read one back the same way when Claude Code hands the task back
to it.

If you're driving Claude Code from Anthropic's own Channels plugin instead
of a self-hosted bridge, the same pattern applies: whichever side initiates
the handoff writes the brief before triggering the other session, and the
receiving side's `SessionStart` hook (or an explicit `mc_get_handoff` call
in headless mode) picks it up.

## Why a dedicated table instead of reusing `runs.steps`

The Agent Run Protocol (`src/lib/runs.ts`) already has a `handoff` step
type, but a run's steps are scoped to one run/session and read back through
that run's transcript — not something a *different*, not-yet-started
session can query by recipient before it has a run of its own. Handoff
briefs are indexed by `to_agent` (and optionally `task_id`) precisely so a
new session can ask "is there anything waiting for me?" before it exists as
a run.
