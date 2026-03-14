# Spec: Bus Health Widget
**Status:** Approved for build  
**Target:** Watson OS overview dashboard (local mode)  
**Date:** 2026-03-13  

---

## Problem

The event bus (`bus.jsonl`) is the nervous system — every agent completion, error, cron run, and memory write flows through it. Right now you can't tell at a glance if it's healthy. You have to open the Intelligence Feed and dig. The overview page has no bus signal at all.

---

## What We're Building

A new dashboard widget: **Bus Health**. One card on the overview page that shows the pulse of the bus in 5 seconds or less. Not a log viewer — a health gauge.

---

## API: `GET /api/bus/health`

New endpoint. Does not replace `/api/bus` — that stays as-is for the Intelligence Feed.

**Response shape:**

```ts
{
  rate_1h: number          // events in last 60 minutes
  rate_24h: number         // events in last 24 hours
  last_event_at: string    // ISO timestamp of most recent event
  agents: {
    [agentName: string]: {
      last_seen: string    // ISO timestamp of most recent event from this agent
      event_count_1h: number
      last_type: string    // most recent event type (e.g. "task_complete")
    }
  }
  errors_1h: number        // count of type="error" events in last hour
  top_types_1h: {          // top 5 event types in last hour
    type: string
    count: number
  }[]
  bus_size_bytes: number   // raw file size of bus.jsonl
  total_events: number     // total line count
}
```

**Implementation notes:**
- Reads bus.jsonl with `tailFile()` — same pattern as existing `/api/bus` route
- Tail last 5,000 lines (covers ~1h at current volume), parse timestamps for windowing
- For 24h rate: tail last 50,000 lines (the bus is ~1.7MB total, fine to read whole file for this endpoint)
- Auth: `requireRole('viewer')` — same as all read endpoints
- 503 if bus.jsonl missing/unreadable
- No writes, no side effects

---

## Widget: `BusHealthWidget`

**File:** `src/components/dashboard/widgets/bus-health-widget.tsx`  
**Registration:** `src/lib/dashboard-widgets.ts` (new entry, `modes: ['local']`)  
**Import:** `src/components/dashboard/widget-grid.tsx`  
**Poll interval:** 30 seconds (bus changes frequently but this isn't real-time)

### Layout

Single card, same width as `RuntimeHealthWidget` (size: `md`).

```
┌─────────────────────────────────────────┐
│  Event Bus                    ● healthy │
│                                         │
│  Rate          142 / hr                 │
│  Last event    2s ago                   │
│  Errors (1h)   0                        │
│                                         │
│  AGENTS                                 │
│  main     ● 2s ago   task_complete      │
│  builder  ● 4m ago   pr_opened          │
│  dispatch ● 8m ago   cron_complete      │
│  condor   ○ 2h ago   agent_done         │
│                                         │
│  Top types (1h)                         │
│  memory_written  ████░░  48             │
│  cron_complete   ██░░░░  18             │
│  agent_done      █░░░░░  9              │
└─────────────────────────────────────────┘
```

### Health Status Logic

The `● healthy / ⚠ slow / ✗ stalled` indicator top-right:

| Condition | Status |
|-----------|--------|
| Last event < 5 min ago, errors_1h == 0 | `healthy` (green) |
| Last event 5–30 min ago OR errors_1h > 0 | `slow` (yellow) |
| Last event > 30 min ago | `stalled` (red) |

### Agent Row Logic

- Show all agents found in last 24h of bus events (skip agents with zero events)
- `●` = last seen < 15 min, `○` = last seen 15+ min
- Truncate agent name to 10 chars
- Sort by most recently seen first

### No Bus / Error State

If `/api/bus/health` returns 503 or fetch fails:
```
┌─────────────────────────────────────────┐
│  Event Bus                    ✗ offline │
│  bus.jsonl not found or unreadable      │
└─────────────────────────────────────────┘
```

---

## Dashboard Registration

In `src/lib/dashboard-widgets.ts`, add:

```ts
{
  id: 'bus-health',
  label: 'Bus Health',
  description: 'Event rate, agent heartbeats, and error count from bus.jsonl',
  category: 'health',
  modes: ['local'],
  defaultSize: 'md',
  component: 'BusHealthWidget',
}
```

Add to default local layout (insert after `runtime-health`).

---

## What This Is NOT

- Not a log viewer (Intelligence Feed handles that)
- Not a bus SQLite viewer (the bus is JSONL, not SQLite)
- Not real-time (30s poll is fine — this is a health gauge, not a stream)
- Not writing anything to the bus

---

## Files Touched

| File | Change |
|------|--------|
| `src/app/api/bus/health/route.ts` | New file |
| `src/components/dashboard/widgets/bus-health-widget.tsx` | New file |
| `src/lib/dashboard-widgets.ts` | Add entry |
| `src/components/dashboard/widget-grid.tsx` | Add import + WIDGET_COMPONENTS entry |

4 files. Bug-fix tier. Builder can ship autonomously.

---

## Pre-mortem

1. **Most likely failure:** `tailFile()` reads 50k lines on every 30s poll, causing noticeable I/O on the Mac Mini. Mitigation: cache the parsed result for 25s server-side, or limit 24h rate to a separate slower fetch.
2. **Wrong assumption:** Agent names in bus events match the known agent list. Reality: any string can appear in `agent` field. Mitigation: show whatever names appear, don't filter to a hardcoded list.
3. **Edge case missed:** Bus events have inconsistent timestamps (some use `ts`, some use `timestamp`, some use `created_at`). The existing `parseBusLines()` already handles this — reuse it.
