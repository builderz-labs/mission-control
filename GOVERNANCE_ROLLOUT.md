# Governance Enforcement Rollout — TASK-009

**Date:** 2026-03-06
**Author:** Jarvis Dev
**Status:** Implemented — pending review & merge

---

## What Was Implemented

### A) API Enforcement

| Rule | Implementation | Enforcement Point |
|------|---------------|-------------------|
| **Mandatory fields before assignment** | `owner`, `deadline`, `context_note`, `definition_of_done`, `priority_tier` (P0-P3) all required when task status leaves `inbox` | `POST /api/tasks` + `PUT /api/tasks/:id` |
| **Strict status transitions** | `inbox → assigned → in_progress → review → done`. No skipping stages. Back-flow allowed for reverts (e.g., `review → in_progress`). Done is terminal. | `PUT /api/tasks/:id` + bulk `PUT /api/tasks` |
| **Evidence-before-done** | At least 1 comment must exist on the task before it can move to `done` | `PUT /api/tasks/:id` + bulk `PUT /api/tasks` |
| **Blocked reason types** | `blocked_type` field: `dependency`, `decision`, `inactivity`. Separate `blocked_reason` text field. | New DB columns, API accepts in create/update |

### B) SLA Engine

| Feature | Details |
|---------|---------|
| **SLA fields** | `ack_by`, `first_artifact_by`, `stale_at` (Unix timestamps) — auto-computed on assignment |
| **Priority-based timings** | P0: 15m/1h/4h, P1: 2h/8h/24h, P2: 8h/24h/3d, P3: 24h/72h/14d |
| **Tracking fields** | `ack_at`, `first_artifact_at` — set when agent moves to `in_progress` |
| **SLA status** | `on_track`, `at_risk` (≥75% of deadline elapsed), `breached` |
| **Re-computation** | Deadlines recalculated when priority_tier changes or task is newly assigned |

### C) Governance Checks

| Check | Details |
|-------|---------|
| **WIP limit** | 3 active tasks per agent (configurable). Enforced on assignment. |
| **Retry cap** | Default 5 retries. `max_retries` field per task. Returns 400 when exceeded. |
| **Decision records** | New `decision_records` table: `decision`, `rationale`, `why_not`, `owner`, `revisit_by`, `confidence`, `status` |
| **SLA events** | New `sla_events` table for tracking escalation events |

### D) UI Updates (Minimal)

| Component | Change |
|-----------|--------|
| **Task card** | Shows `P0/P1/P2/P3` badge + SLA status badges (`⚠ At Risk`, `🔴 Breached`) |
| **Create task modal** | Governance fields appear when assignee is selected (priority tier, deadline, context note, definition of done) |
| **Edit task modal** | Governance section with priority tier, blocked type/reason, context note, definition of done |
| **Error display** | Both create and edit modals now display API validation errors inline |

### E) Quality

| Item | Status |
|------|--------|
| **Migration** | `027_governance_enforcement` — adds columns, indexes, and new tables |
| **Unit tests** | 32 new tests in `governance.test.ts` covering all enforcement rules |
| **All tests** | 134/134 passing |
| **Build** | `pnpm build` passes clean |

---

## Database Changes (Migration 027)

### Tasks table — new columns:
- `context_note TEXT` — why this task matters
- `definition_of_done TEXT` — explicit completion criteria
- `priority_tier TEXT` — P0/P1/P2/P3
- `ack_by INTEGER` — SLA: acknowledge by timestamp
- `first_artifact_by INTEGER` — SLA: first artifact by timestamp
- `stale_at INTEGER` — SLA: stale after timestamp
- `ack_at INTEGER` — when agent acknowledged
- `first_artifact_at INTEGER` — when first artifact was produced
- `sla_status TEXT` — on_track/at_risk/breached
- `blocked_reason TEXT` — why task is blocked
- `blocked_type TEXT` — dependency/decision/inactivity
- `max_retries INTEGER DEFAULT 5` — retry cap per task

### New tables:
- `decision_records` — structured decision log with `why_not`, `revisit_by`
- `sla_events` — escalation event log

### New indexes:
- `idx_tasks_sla_status`, `idx_tasks_priority_tier`, `idx_tasks_ack_by`, `idx_tasks_stale_at`
- Decision records and SLA events indexes

---

## Breaking Changes

**API consumers** that were skipping statuses (e.g., `inbox → done`) will now receive `400` errors. The valid flow is:

```
inbox → assigned → in_progress → review → [quality_review] → done
```

**Tasks being assigned** must now include: `assigned_to`, `due_date`, `context_note`, `definition_of_done`, and `priority_tier`.

**Agents at WIP limit** (3 active tasks) will receive `409` when trying to accept new tasks.

---

## Known Limitations (Acceptable for Week 1)

1. **SLA status is point-in-time** — updated on task write operations, not via background cron. A task could breach its `stale_at` deadline between API calls without the `sla_status` field updating. Week 2 cron job will sweep and update.
2. **Mandatory field enforcement on updates** — only enforced when transitioning OUT of inbox (not on edits to already-assigned legacy tasks without governance fields). This prevents blocking edits to pre-existing tasks.
3. **WIP limit is not configurable per-agent via UI** — defaults to 3. Can be overridden in code (`getWipLimit`). UI config is a future enhancement.

## What's NOT in This PR (Week 2+)

Per the governance synthesis, these are deferred:
1. **Nudge ladder automation** — auto-escalation messaging
2. **Prediction registry** — estimate vs actual tracking with optimism buffers
3. **Weekly scorecard dashboard** — aggregated governance metrics
4. **Red team role enforcement** — mandatory dissent for high-stakes decisions
5. **Token budget guardrails** — per-task token spend limits

---

## Rollback Plan

If issues arise:
1. The migration is additive (new columns/tables only) — no data loss on rollback
2. Revert the branch; existing data remains intact
3. New columns will be `NULL` for existing tasks — no breakage

---

## Feedback Sources Incorporated

- **Mira:** Evidence-before-done, blocked vs stale distinction, decision timeout patterns
- **Friday:** Token/retry cap, kill signals for spinning agents, quality gates
- **Scout:** SLA thresholds, artifact auditing, WIP limits, prediction registry (deferred)
- **Zayd:** Single owner accountability, stale detection, escalation format
- **SukuQi:** Decision records with `why_not`, revisit enforcement, append-only audit trail
