# OpenClaw Config Compatibility Note

Date: 2026-04-01

## Incident

An OpenClaw install failed to start the gateway because `~/.openclaw/openclaw.json`
contained a legacy top-level `fallbacks` key inside `agents.list[*]`.

The runtime schema rejected entries like:

```json
{
  "id": "coder",
  "model": "anthropic/claude-sonnet-4-6",
  "fallbacks": []
}
```

Doctor output showed:

```text
Invalid config:
- agents.list.0: Unrecognized key: "fallbacks"
```

## Root Cause

Mission Control still normalized `model.fallbacks`, but it also preserved any old
top-level `agent.fallbacks` already present in `openclaw.json` during write-back.

That meant any agent edited from the dashboard could keep re-saving an invalid
gateway config even if the current UI no longer depended on that field.

## Fix

The write-back normalizer in `src/lib/agent-sync.ts` now removes legacy
top-level `agent.fallbacks` before writing back to `openclaw.json`.

Regression coverage lives in:

- `src/lib/__tests__/agent-sync.test.ts`

## Recovery

If this happens again on a live install:

1. Remove `fallbacks` from each entry in `agents.list` inside `~/.openclaw/openclaw.json`.
2. Run `openclaw doctor`.
3. Verify with `openclaw gateway status`.

Expected result:

- `openclaw doctor` no longer reports `Unrecognized key: "fallbacks"`.
- `openclaw gateway status` shows `Runtime: running` and `RPC probe: ok`.
