# Atlas Self-Improvement Loop

Atlas (Chief of Staff orchestrator) reflects on the agent fleet each week, learns
**coordination rules** that should make hand-offs and escalations smoother, and
then **measures** whether each change actually moved its target metric — auto-arming
rules that work and retiring rules that don't. It is the top layer of the
briefing → incident-learning → Atlas stack.

It deliberately mirrors the two proven precedents already in the codebase:

- **Sofia's `correctionLearner`** — shadow → armed promotion, min-hits, confidence
  gating, never auto-override a human decision.
- **MC's own incident learning loop** (`src/lib/incident-learning.ts`) — same
  shape, in this repo, against SQLite.

## The weekly loop (Fridays 17:00 UTC)

1. **Measure** — for every active rule with a measurable metric, compute that
   metric for the week just ending and compare to the rule's baseline. Update
   `applied_count`, `success_count`, `success_rate`, `avg_outcome_improvement`,
   `confidence`. Auto-arm rules that clear the gate; auto-retire rules that have
   been applied enough times and aren't working. Human decisions
   (`status_source='manual'`) are never overridden.
2. **Collect the week** — assemble agent briefings, task outcomes
   (completed / overdue / stalled, per agent), hand-offs and escalations (from the
   `activities` log + high/urgent tasks), and incidents + incident outcomes.
3. **Reflect** — feed the week to Claude (via `callAnthropic`, the same key
   resolution the `/api/v1/messages` proxy uses) and ask: which hand-offs worked?
   which broke down? what bottlenecks emerged? what should change next week?
   Claude returns prose + structured `insights`, `bottlenecks`, and
   `recommended_rules`. If no Anthropic key is configured (or the call fails), a
   **deterministic heuristic** produces the reflection + rule proposals so the
   loop still runs and the dashboard is never empty.
4. **Learn** — each recommended rule is upserted as `status='shadow'` with a
   hypothesis, a target metric, and a baseline captured at creation. A `running`
   experiment is opened so next week's Measure step can score it.

## Tables

### `atlas_weekly_reflections`
One row per `(week_of, workspace_id)`. Holds the prose `reflection`, JSON
`insights` / `handoffs` / `bottlenecks`, the `data_snapshot` that fed it,
`improvements_recommended` / `improvements_implemented`, token usage, and
`generated_by` (`ai` | `heuristic`).

### `atlas_coordination_rules`
The learned rules. `trigger_event` + `condition` → `then_action` (optionally
involving `target_agent`). Carries `hypothesis`, `metric`, `metric_direction`,
`baseline`, the running scorecard (`applied_count` / `success_count` /
`success_rate` / `avg_outcome_improvement` / `confidence`), and
`status` (`shadow` | `armed` | `rejected` | `retired`) with `status_source`.

### `atlas_experiments`
One row per `(rule_id, week_of)`. The test-and-measure record:
`baseline`, measured `result`, `impact` (signed toward improvement), `verdict`
(`improved` | `no_change` | `worsened` | `inconclusive`), `status`.

## Metrics we can measure

Measurement is portfolio-level and directional (we do not have per-rule causal
attribution). Each rule targets one metric, scored week-over-week against the
baseline captured when the rule was created:

| metric | source | direction |
|---|---|---|
| `time_to_resolution` | `incident_outcomes.resolution_hours` | lower is better |
| `task_completion_rate` | done / touched tasks | higher is better |
| `task_blocked_rate` | (overdue + stalled) / touched tasks | lower is better |
| `cost_prediction_accuracy` | `prediction_accuracy` overall | higher is better |
| `escalation_volume` | high/critical incidents in week | lower is better |

Unknown metrics yield a `null` result → the experiment stays `inconclusive`
rather than fabricating a number.

## Gating (env-overridable)

- `ATLAS_ARM_MIN_APPLIED` (default 3) — weeks measured before a rule can arm.
- `ATLAS_ARM_MIN_SUCCESS_RATE` (default 0.6).
- `ATLAS_ARM_MIN_CONFIDENCE` (default 0.7).
- `ATLAS_RETIRE_MIN_APPLIED` (default 4) — weeks before a failing rule retires.
- `ATLAS_RETIRE_MAX_SUCCESS_RATE` (default 0.34).
- `MC_ATLAS_MODEL` (default `claude-opus-4-8`).

## API

- `GET /api/atlas` → `{ reflections, rules, experiments, summary }` (viewer).
- `POST /api/atlas` (operator), action-dispatched:
  - `{ action: 'reflect', week_of? }` — run a reflection now.
  - `{ action: 'measure', week_of? }` — re-score experiments now.
  - `{ action: 'arm' | 'shadow' | 'reject' | 'retire', rule_id }` — manual rule
    status (sets `status_source='manual'`; the weekly pass then leaves it alone).

## Scheduler

`weekly_atlas_reflection` runs Fridays 17:00 UTC via the existing scheduler tick
(`src/lib/scheduler.ts`), toggled by the `general.weekly_atlas_reflection`
setting. Manually triggerable through the scheduler's `triggerTask`.

## Dashboard

`/atlas` — Reflections (prose + insights + bottlenecks), Coordination Rules
(scorecard + arm/reject controls), and Experiments (baseline → result → verdict).
