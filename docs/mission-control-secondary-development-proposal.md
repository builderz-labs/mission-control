# Mission Control Secondary-Development Proposal

## Goal

Adapt Mission Control into a secondary-development base for a site-task runtime/control plane using a dual-layer architecture:

1. **Control Plane Layer** — Mission Control remains the operator-facing source of truth for tasks, runs, agents, sessions, scheduling, review, and audit.
2. **Runtime Layer** — a site-task execution layer handles site-specific planning, execution, handoff, and environment integration while reporting state back into Mission Control.

This approach preserves Mission Control’s existing orchestration strengths and avoids rebuilding proven workflow, scheduling, and observability primitives.

## Why Mission Control is a Strong Base

Mission Control already provides the core control-plane capabilities needed for a site-task system:

- task intake, assignment, dispatch, and review
- agent registry and live status tracking
- session discovery and runtime linkage
- scheduler-driven automation
- recurring task spawning
- realtime event propagation
- run-state persistence
- RBAC, audit logging, and API surfaces

The existing product surface is already aligned with a multi-agent operations dashboard rather than a single-purpose app. See:

- `src/app/[[...panel]]/page.tsx`
- `src/components/panels/task-board-panel.tsx`
- `src/lib/db.ts`
- `src/lib/scheduler.ts`
- `src/lib/task-dispatch.ts`
- `src/lib/runs.ts`
- `src/lib/event-bus.ts`

## Proposed Dual-Layer Architecture

### Layer 1: Mission Control as the orchestration control plane

Mission Control should continue to own:

- canonical task records
- workflow state transitions
- agent registration and health
- scheduler jobs and recurring automation
- execution history / run tracking
- operator UI and API access
- quality gates and review policy
- notifications, activity feed, and audit trail

This maps cleanly to current modules:

- **task workflow** — `src/app/api/tasks/route.ts`, `src/lib/task-status.ts`
- **dispatch/orchestration** — `src/lib/task-dispatch.ts`
- **background jobs** — `src/lib/scheduler.ts`
- **recurrence/template spawning** — `src/lib/recurring-tasks.ts`
- **execution lifecycle** — `src/lib/runs.ts`
- **realtime propagation** — `src/lib/event-bus.ts`
- **session linkage** — `src/lib/sessions.ts`
- **task-board UX** — `src/components/panels/task-board-panel.tsx`

### Layer 2: Site-task runtime as the execution substrate

The new runtime layer should own site-specific execution concerns that Mission Control should not absorb directly:

- site environment bootstrapping
- repo/workspace selection
- site-task planning/execution logic
- runtime-specific toolchains and adapters
- per-site metadata and execution context
- external system side effects
- task implementation targeting

Mission Control already has a useful starting point for this boundary in `src/lib/task-routing.ts`, which resolves implementation targets from task metadata. That pattern can be expanded into a runtime contract instead of hard-coding site behavior into the dashboard.

## Core Reuse Recommendations

### 1. Reuse the existing task lifecycle instead of inventing a new workflow engine

Mission Control already exposes the right workflow backbone:

- schema-backed task statuses in `src/lib/db.ts`
- normalization rules in `src/lib/task-status.ts`
- kanban/status UX in `src/components/panels/task-board-panel.tsx`
- API entrypoint in `src/app/api/tasks/route.ts`

Recommended adaptation:

- keep Mission Control task status as the control-plane status
- attach site-runtime details in task metadata rather than replacing task state semantics
- treat runtime sub-steps as run/step records, not top-level task statuses

This avoids coupling site execution details to board columns.

### 2. Reuse `runs.ts` as the execution lifecycle abstraction

`src/lib/runs.ts` is the strongest existing abstraction for execution state. It already models:

- `pending | running | completed | failed | cancelled | timeout`
- trigger source
- step types
- provenance/cost/eval fields

Recommended adaptation:

- model each site-task execution attempt as a run
- record runtime sub-steps as run steps
- keep task records operator-facing and durable
- use runs for attempt-level detail, telemetry, and replayability

This creates a clean separation:

- **task** = business/work queue object
- **run** = execution attempt
- **step** = internal execution trace

### 3. Reuse scheduler and recurring patterns as-is where possible

`src/lib/scheduler.ts` and `src/lib/recurring-tasks.ts` already provide the backbone for autonomous operation:

- dispatch assigned tasks
- run Aegis reviews
- requeue stale tasks
- auto-route inbox tasks
- spawn recurring tasks from templates

Recommended adaptation:

- add site-runtime dispatch as another scheduler-owned execution path
- keep recurring tasks as template records that spawn site-specific work items
- prefer extending current scheduler jobs over adding a separate scheduler stack

If site work needs special timing or throttling, carry that in metadata/config rather than forking the scheduler model.

### 4. Reuse event propagation for runtime observability

`src/lib/event-bus.ts` already standardizes server-side event publication for:

- task changes
- notifications
- activities
- agent updates
- run lifecycle events

Recommended adaptation:

- emit runtime events through the same bus
- use existing SSE/web UI consumption patterns instead of adding a second realtime channel
- standardize runtime progress onto run/task event families where possible

This keeps operators on one control surface.

### 5. Reuse session linkage, but do not make sessions the primary domain model

`src/lib/sessions.ts` is valuable for runtime discovery and traceability. It should remain a linked observability surface, not the source of truth for site-task workflow.

Recommended adaptation:

- allow runs/tasks to reference runtime sessions when available
- keep task/run state authoritative in DB
- use sessions for drill-down, transcript linkage, and live activity

## Recommended Domain Model Extension

Keep Mission Control’s existing core entities and add only the minimum site-runtime metadata needed.

### Keep authoritative existing entities

- `tasks`
- `agents`
- `activities`
- `notifications`
- `quality_reviews`
- `runs` / run-step records

### Add site-runtime concepts through metadata first

Short-term, use task/run metadata for:

- `site_id`
- `workspace_id` or repo target
- runtime adapter name
- execution target path
- environment profile
- plan artifact refs
- deploy preview / output refs

Only promote these into first-class tables after repeated pressure from real workflows.

### Candidate future first-class tables

If metadata becomes too overloaded, promote carefully to:

- `sites`
- `site_environments`
- `site_task_bindings`
- `runtime_adapters`

That should be a later step, not phase one.

## Integration Boundary

The cleanest control-plane/runtime contract is:

### Mission Control sends

- task identity and title/description
- assignment info
- priority and due date
- runtime target metadata
- prior review/rejection feedback
- execution policy hints

### Runtime returns

- accepted/rejected claim
- run id / session linkage
- incremental progress events
- structured result
- artifacts/URLs/refs
- terminal outcome
- retryable vs non-retryable failure classification

Mission Control should remain responsible for final workflow transitions. The runtime should report execution facts, not mutate workflow policy directly.

## Existing Patterns to Reuse Directly

### Kanban + owner-blocked workflow pattern

`src/components/panels/task-board-panel.tsx` already includes a useful operator-friendly workflow model, including `awaiting_owner` heuristics. This is a strong fit for site-task work where runtime execution may pause for human input, credentials, approvals, or content decisions.

Recommendation:

- preserve this pattern in the board UX
- use explicit owner-blocked metadata where possible
- avoid creating a separate approval system for runtime pauses

### Quality-gated completion

Mission Control’s review flow already supports a meaningful gate:

- task progresses to `review`
- Aegis or reviewer approves/rejects
- rejected work returns to `assigned`

That is directly reusable for site-task secondary development, where runtime output should often be reviewed before being treated as complete.

### Template-clone recurring work

Recurring tasks already use a template-to-child spawn model. This is a good fit for:

- scheduled audits
- site refresh tasks
- recurring content or maintenance jobs
- periodic environment checks

No redesign needed.

## Proposed Adaptation Plan

### Phase 1: Minimal control-plane reuse

Use Mission Control mostly as-is and add only metadata/routing needed for site-task runtime dispatch.

Deliverables:

- site-task metadata contract on tasks/runs
- runtime adapter boundary based on current dispatch/routing modules
- run linkage for site execution attempts
- operator-visible task/run/session traceability

Primary touchpoints:

- `src/lib/task-dispatch.ts`
- `src/lib/task-routing.ts`
- `src/lib/runs.ts`
- `src/app/api/tasks/route.ts`

### Phase 2: Runtime-aware dispatch and monitoring

Expand dispatch to distinguish generic agent work from site-task runtime work.

Deliverables:

- runtime adapter selection
- structured execution result ingestion
- richer run-step traces
- runtime health and failure classification

Primary touchpoints:

- `src/lib/task-dispatch.ts`
- `src/lib/scheduler.ts`
- `src/lib/event-bus.ts`
- `src/lib/sessions.ts`

### Phase 3: Site-aware UX surfaces

Add site/runtime-focused operator views only after the runtime contract stabilizes.

Deliverables:

- site filter/grouping on task views
- run drill-down for site-task execution
- runtime status panels if needed
- artifact/output links in board/detail views

Primary touchpoints:

- `src/components/panels/task-board-panel.tsx`
- `src/store/index.ts`
- targeted new panels only if existing views become insufficient

## What Not to Do

### Do not fork Mission Control into a separate workflow engine

The current codebase already has coherent workflow, scheduler, run, and event abstractions. Replacing them would lose the main advantage of using Mission Control as a base.

### Do not encode site-specific states into top-level task statuses too early

Task statuses should stay operator-oriented and stable. Site execution nuance belongs in run steps and metadata.

### Do not split realtime or audit into a second subsystem

Reuse Mission Control’s event bus, activities, notifications, and audit surfaces.

### Do not prematurely normalize every site concept into tables

Start with metadata. Promote only what becomes operationally necessary.

## Main Risks

### 1. Control-plane/runtime boundary leakage

Risk:
Site-specific logic gets embedded across UI, scheduler, and task APIs.

Mitigation:
Keep runtime selection and execution behind a narrow adapter boundary rooted in dispatch/routing.

### 2. Status explosion

Risk:
Adding many new task states to reflect runtime internals makes the board noisy and brittle.

Mitigation:
Keep board statuses coarse; use runs and step traces for execution detail.

### 3. Duplicate orchestration paths

Risk:
A new site-task scheduler or event system duplicates existing Mission Control behavior.

Mitigation:
Extend existing scheduler/event infrastructure before introducing new services.

### 4. Over-modeling too early

Risk:
Schema churn slows development before real runtime patterns are proven.

Mitigation:
Use metadata-first extension and only normalize proven concepts.

## Recommendation

Use Mission Control as the control-plane foundation with minimal structural change. The strongest reusable foundation is:

- `task-board-panel.tsx` for operator workflow
- `task-status.ts` + task APIs for canonical workflow transitions
- `task-dispatch.ts` + `scheduler.ts` for orchestration
- `runs.ts` for runtime execution lifecycle
- `event-bus.ts` for realtime propagation
- `sessions.ts` for traceability into active runtimes
- `recurring-tasks.ts` for template-driven automation

The preferred path is not to turn Mission Control into the site-task runtime itself. The preferred path is to keep Mission Control as the orchestration control plane and attach a site-task runtime beneath it through a narrow dispatch/result contract.

## Suggested Immediate Next Slice

Implement the smallest vertical slice that proves the dual-layer model:

1. create a site-task metadata contract on tasks
2. route a site-task through dispatch into a runtime adapter
3. create/update a run for the execution attempt
4. publish progress via the existing event bus
5. return result into review/done or assigned/retry flow
6. expose the trace in existing task and run surfaces

If that slice works cleanly, the architecture is validated without needing a broad schema or UI rewrite.
