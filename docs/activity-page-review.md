# Activity Page Review

**URL:** `/activity` (e.g. http://192.168.50.114:3000/activity)

## How It Works

### 1. Routing and component

- **Route:** App Router `[[...panel]]` with `panel=activity` (or `history`) renders `ActivityFeedPanel`.
- **Component:** `src/components/panels/activity-feed-panel.tsx`.

### 2. Data sources

| Source | API | Purpose |
|--------|-----|--------|
| **Activities** | `GET /api/activities` | Stream of events (task created, agent status change, comments, etc.). Supports `?actor=`, `?type=`, `?limit=`, `?offset=`, `?since=`. |
| **Sessions** | `GET /api/sessions` | List of live sessions for the sidebar when an agent is selected. Merged from multiple backends. |
| **Agents** | Global store (from `GET /api/agents` on app load) | Agent list used for the filter chips (“All” / per-agent). |

### 3. How activities are populated

- **Storage:** `activities` table in SQLite (see `src/lib/schema` / migrations).
- **Writes:** Only when Mission Control code calls `db_helpers.logActivity()`. That happens from:
  - Task create/update/delete, comments, branch, broadcast
  - Agent heartbeat, status change, create, register, message, soul/memory/file updates
  - Pipeline run, GitHub sync, standup, notifications, session control (set-thinking, etc.)
  - Connect/disconnect, quality review, workflows, memory file create/save/delete
- **Flow:** `logActivity` → INSERT into `activities` → `eventBus.broadcast('activity.created', …)` for SSE.
- **Conclusion:** The feed is an **MC-internal audit trail**. It does not automatically ingest external event streams (e.g. raw gateway or Hermes events) unless we add code to do so.

### 4. How sessions are populated (monitoring)

`GET /api/sessions` merges:

| Source | Backend | How |
|--------|---------|-----|
| **Gateway sessions** | OpenClaw-style | `getAllGatewaySessions()` in `src/lib/sessions.ts` reads **`config.openclawStateDir`** only: `{openclawStateDir}/agents/{agentName}/sessions/sessions.json`. |
| **Claude Code** | Local | `syncClaudeSessions()` + `getLocalClaudeSessions()` from DB table `claude_sessions`. |
| **Codex** | Local | `scanCodexSessions()` from `src/lib/codex-sessions.ts` (e.g. `~/.codex/sessions`). |
| **Hermes** | Local | `getLocalHermesSessions()` → `scanHermesSessions()` in `src/lib/hermes-sessions.ts` reads **`~/.hermes/state.db`** (SQLite `sessions` table). |

So the Activity page **does support monitoring agents from**:

- **Claude Code** (local DB)
- **Codex** (local scan)
- **Hermes** (local `state.db` sessions)
- **Gateway** (only OpenClaw-style layout under `openclawStateDir`; Hermes gateway does not use that path for session stores)

Hermes sessions are already included via the **local** Hermes scanner; they appear with `kind: 'hermes'` and `agent: 'hermes'`.

### 5. Agent filter on the Activity page

- The agent chips come from **`useMissionControl().agents`**.
- Agents are loaded on app init from **`GET /api/agents`**, which returns rows from the `agents` table.
- The `agents` table is synced from **gateway config** (e.g. `gateway.json` when `HERMES_HOME` is set) via `syncAgentsFromConfig` in the scheduler and agent-sync. So **Hermes agents defined in gateway.json already appear** in the agent list and can be used to filter the activity feed.

---

## What Needs to Change for Hermes

### Already working

- **Sessions:** Hermes sessions from `~/.hermes/state.db` are shown in the session list (local Hermes).
- **Agents:** Hermes agents from `gateway.json` are synced into `agents` and appear in the Activity agent filter.
- **Activity feed:** Any MC action that calls `logActivity` (tasks, agent heartbeats, etc.) appears; if Hermes agents are registered and send heartbeats to MC, those show up.

### Gaps / optional improvements

1. **Gateway sessions from Hermes**
   - `getAllGatewaySessions()` only looks at **`config.openclawStateDir`** (`~/.openclaw/agents/.../sessions.json`).
   - Hermes does not use that layout; it uses `~/.hermes/state.db`. So “gateway” session list is currently OpenClaw-only.
   - **Change:** Either document that Hermes sessions are only from the local scanner, or add a Hermes-aware path in `sessions.ts` (e.g. when `config.hermesHome` is set, also derive “gateway” sessions from Hermes state.db or from a Hermes-specific session store if one exists). Right now Hermes sessions are already present via `getLocalHermesSessions()`, so this is only relevant if Hermes adds a separate “gateway” session store.

2. **Activity feed entries for Hermes-originated events**
   - Today, no code writes to `activities` based on Hermes state (e.g. “Session started in Hermes”, “Hermes agent X completed a run”).
   - **Change (optional):** To show Hermes activity in the feed:
     - **Option A:** Scheduler (or a dedicated job) periodically reads Hermes state (e.g. `state.db` or `gateway_state.json`) and inserts `logActivity` rows for new sessions or state changes.
     - **Option B:** If Hermes gateway pushes events to MC (webhook or SSE), consume those and call `db_helpers.logActivity(...)` so they appear in the feed.
   - Without this, the feed will only show MC-originated events (and agent heartbeats when Hermes agents report in via MC’s agent APIs).

3. **Session control (POST /api/sessions)**
   - Set-thinking, set-verbose, set-reasoning, set-label, and session delete use **`callOpenClawGateway()`** (OpenClaw CLI `gateway call`).
   - **Change:** If Hermes supports the same RPC or a different API for session control, add a Hermes path (e.g. call Hermes API or `hermes` CLI when gateway is Hermes) so the Activity page’s session controls work for Hermes sessions.

4. **Agent “hermes” in the filter**
   - Local Hermes sessions use a single `agent: 'hermes'`. If you want to filter the Activity feed by Hermes, ensure an agent named `hermes` (or the actual Hermes agent names from gateway.json) exists in the agents table so the filter chip appears. Agent sync from `gateway.json` should create these when Hermes agents are configured.

---

## Summary

- **How it works:** Activity page shows (1) an activity stream from the `activities` table (MC events only), (2) a session list merged from gateway (OpenClaw layout), Claude Code, Codex, and Hermes local scanner, and (3) an agent filter from the synced `agents` table.
- **Monitoring:** It does support monitoring agents from **Claude Code**, **Codex**, and **Hermes** (sessions). Gateway sessions are only read from the OpenClaw-style directory.
- **Hermes:** Sessions and agents from Hermes already integrate. Remaining work is optional: ingest Hermes-originated events into the activity feed, and support Hermes in session control and (if needed) gateway session reading.
