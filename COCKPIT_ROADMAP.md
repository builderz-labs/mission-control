# Mission Control — Agent Cockpit ROADMAP

Turn Mission Control into the team's project-management cockpit for the agent fleet,
built **entirely on what already runs** (Atlas dispatch + Atlas task_log + the cost
tracker + per-agent `ROADMAP.md`). No LibreChat, no OpenClaw, no new server.

> 🚨 **Box safety (non-negotiable).** The VPS crash-looped 3× on 23 Jun 2026 (OpenClaw
> gateway). It's now CPX31/8GB but still hosts MC + 5 docuseal + postgres + vaultwarden.
> Every change here is **read-only-first**. Follow the proven **export→mount→render**
> pattern (Atlas writes JSON to `/opt/atlas/data/*.json` → mounted read-only into MC at
> `/atlas-data` → MC route reads it → panel renders). NEVER add a heavy always-on process.
> Deploy MC by `docker compose build` with the gateway/heavy jobs quiet; deploy only
> changed files; verify load/free after.

## The 6 panels (4 gaps + 2 PM surfaces)

| # | Panel | Source (already exists) | Phase | Risk |
|---|-------|-------------------------|-------|------|
| 1 | **Build timeline** (swimlanes by agent/week) | per-agent `~/<agent>/ROADMAP.md` (phase/shipped/blocked/next-3) | 1 | read-only |
| 2 | **Agent-to-agent feed** (handoff chips) | Atlas `task_log` / dispatch handoffs | 1 | read-only |
| 3 | **Tools / MCP catalog per agent** | each agent's MCP config + the Integrations page | 1 | read-only |
| 4 | **Per-conversation cost** | Atlas dispatch cost records (already captured) | 1 | read-only |
| 5 | **Approvals inbox** (approve/reject) | the Slack approval gate (`DISPATCH_REQUIRE_APPROVAL`) | 2 | action |
| 6 | **Live chat thread** (conversational dispatch) | the Atlas `/dispatch` bridge | 2 | action |

## Phase 1 — read-only cockpit (safe, ship now)

All four read-only panels render from ONE Atlas export. No runtime risk.

### Data contract — `/opt/atlas/data/mc_cockpit.json` (mounted → MC `/atlas-data/mc_cockpit.json`)
```json
{
  "generated_at": "2026-06-23T14:00:00Z",
  "week_now": 26,
  "timeline": [
    { "agent": "iris",
      "items": [
        { "title": "facts/FAQ", "status": "shipped",  "start_week": 25, "end_week": 26 },
        { "title": "upsell recovery", "status": "building", "start_week": 27, "end_week": 28 }
      ] }
  ],
  "agent_feed": [
    { "ts": "2026-06-23T13:40:00Z", "from": "james", "to": "aria",
      "summary": "confirm current ADR", "kind": "handoff", "cost_usd": 0.04 }
  ],
  "tools": [
    { "agent": "james",
      "connectors": [ { "name": "QuickBooks", "status": "connected" },
                      { "name": "Slack", "status": "connected" } ] }
  ],
  "conversations": [
    { "id": "disp-145", "agent": "james", "cost_usd": 0.31, "turns": 4,
      "last_ts": "2026-06-23T13:45:00Z", "title": "rebuild June P&L" }
  ]
}
```
- `status` enum: `shipped | building | blocked | planned`.
- Weeks are ISO week numbers; MC renders a rolling 5-week window around `week_now`.
- Missing/unparseable agent → omit from `timeline`, never fabricate (mirror the
  "no silent mock" rule already in `/api/epl/agents`).

### Atlas side (repo `~/atlas`)
- New `scripts/export_cockpit.py` → writes `data/mc_cockpit.json`:
  - **timeline**: parse each `~/<agent>/ROADMAP.md` (phase / Shipped / Blocked / Next-3
    sections) into dated items. No SSH storm — read local clones already on the VPS.
  - **agent_feed**: read Atlas `task_log` (the dispatch/handoff records) → last ~30 events.
  - **conversations**: group dispatch cost records by dispatch/thread id.
  - **tools**: per-agent MCP/connector list (start from a static map of each agent's known
    connectors; later read each agent's real MCP config).
- systemd `atlas-cockpit-export.timer` every 10 min (mirror `mc-properties-export`). Light.

### Mission Control side (repo `~/mission-control`)
- New `src/app/api/epl/cockpit/route.ts` → reads `/atlas-data/mc_cockpit.json` (graceful
  empty if missing; never 500).
- New panels (mirror `epl-properties-panel.tsx` + `epl-panel-frame.tsx` conventions):
  - `epl-timeline-panel.tsx`, `epl-agent-feed-panel.tsx`, `epl-tools-panel.tsx`,
    and per-conversation cost surfaced on the existing cost/agent cards.
- Register in the dashboard panel list like the other EPL panels.

## Phase 2 — action surfaces (build behind a flag, TEST before prod)

These DO things, so they ride the secured Atlas bridge and ship gated OFF first.

- **Approvals inbox (#5):** MC lists pending approvals from the export, with
  approve/reject → `POST /api/epl/approvals/:id` → Atlas releases or kills the gated
  dispatch. **One source of truth:** MC is canonical; approving in MC must also resolve
  the Slack prompt (and vice-versa) — no double-gate drift. Gate behind
  `COCKPIT_APPROVALS_ENABLED`.
- **Live chat (#6):** "conversational dispatch" — MC chat panel → `POST` a turn to Atlas
  carrying a `thread_id` → Atlas runs `claude_task` with thread context → MC polls the
  reply back into the panel. Read-only Q&A ungated; any *action* keeps the approval gate.
  Gate behind `COCKPIT_CHAT_ENABLED`. **Do NOT deploy interactive chat to the box without
  a staged test** (it's the closest thing to the gateway's always-on load that broke the box).

## Sequencing / ownership
- Build split by repo so two sessions never touch the same repo (global co-work rule):
  - Session A → `~/atlas` (the exporter + timer).
  - Session B → `~/mission-control` (the route + read-only panels; scaffold Phase-2 gated).
- Phase 2 wiring (approvals/chat actions) is a third increment after Phase 1 is live + verified.
