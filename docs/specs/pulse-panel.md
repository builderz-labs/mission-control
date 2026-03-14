# Pulse Panel — Replace Activity with Live Bus View

## Vision
Replace the sparse Activity panel with a Pulse panel that shows Watson's operational heartbeat — live gateway bus events, pulse cron outputs, heartbeat status, and system health in one view.

## Tabs / Views
1. **Bus** — Raw gateway event stream (all events, filterable by agent/type/level)
2. **Pulse** — Output from watson-pulse crons (v5-pulse, v5-signal, v5-recall, v5-builder)
3. **Heartbeat** — Tier 1 (every heartbeat interval) and Tier 2 (4x daily) status
4. **Health** — System health cron output, CPU/memory/disk trends

## Data Sources
- **Bus events**: Gateway WebSocket connection (already established via `useWebSocket`)
- **Pulse cron output**: Read from cron session transcripts or delivery output
- **Heartbeat**: Agent heartbeat API + heartbeat cron history
- **Health**: system-health-and-watchdog cron output

## UI Design
- Keep the Activity icon and position in nav
- Rename from "Activity" to "Pulse"
- Tab bar at top: Bus | Pulse | Heartbeat | Health
- Bus tab: streaming log view with auto-scroll, level/agent/type filters
- Pulse tab: cards showing last pulse output per cron, with trend sparklines
- Heartbeat tab: agent grid showing last heartbeat time, status dot, tier info
- Health tab: CPU/memory/disk gauges, uptime, recent watchdog alerts

## MVP Scope
- Bus tab only (live gateway events via WebSocket/SSE)
- Filters: agent, event type, level
- Auto-scroll with pause button
- Replace current Activity panel

## Future
- Pulse/Heartbeat/Health tabs
- Trend charts over time
- Alert integration (flash when threshold exceeded)
