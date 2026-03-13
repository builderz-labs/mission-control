# Aegis Dedicated Quality Review Agent

## Overview

Aegis is Mission Control's automated quality review system. When an agent completes a task, Aegis reviews the output before the task can be marked as "done".

## Self-Review Problem

By default, Aegis uses the **same agent** that completed the task to perform the review. This creates a self-review bias where an agent evaluates its own work.

## Solution: Dedicated Aegis Agent

Set `MC_AEGIS_AGENT_ID` to use a dedicated agent for all quality reviews:

```bash
# .env
MC_AEGIS_AGENT_ID=aegis
```

### Step 1: Create Aegis Agent in openclaw.json

```json
{
  "agents": {
    "list": [
      {
        "id": "aegis",
        "name": "Aegis Quality Reviewer",
        "default": false,
        "model": {
          "primary": "claude-sonnet-4-20250514",
          "fallbacks": ["claude-3-5-sonnet-20241022"]
        },
        "identity": {
          "name": "Aegis",
          "theme": "quality-assurance",
          "emoji": "🧪"
        },
        "tools": {
          "allow": ["read", "web_search", "github"]
        },
        "sandbox": {
          "mode": "restrict"
        }
      }
    ]
  }
}
```

### Step 2: Configure Mission Control

```bash
# .env
MC_AEGIS_AGENT_ID=aegis
```

## How It Works

1. Agent completes task → status moves to `review`
2. Aegis scheduler picks up task
3. **If `MC_AEGIS_AGENT_ID` is set:** Uses dedicated Aegis agent
4. **If not set:** Uses task's assigned agent (legacy behavior)
5. Aegis evaluates resolution against task requirements
6. `VERDICT: APPROVED` → status → `done`
7. `VERDICT: REJECTED` → status → `in_progress` with feedback

## Benefits

- **Eliminates self-review bias:** Different agent reviews the work
- **Consistent quality standards:** Same reviewer for all tasks
- **Configurable model:** Use stronger/smarter model for reviews
- **Optional:** Works without configuration (backward compatible)

## Environment Variable

| Variable | Required | Description |
|----------|----------|-------------|
| `MC_AEGIS_AGENT_ID` | No | Agent ID to use for Aegis quality reviews. Defaults to task's assigned agent. |

## Example Configuration

```bash
# Use dedicated aegis agent with stronger model
MC_AEGIS_AGENT_ID=aegis
```

## Backward Compatibility

If `MC_AEGIS_AGENT_ID` is not set, the system behaves exactly as before (uses the task's assigned agent for review).
