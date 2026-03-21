# Mission Control-native Edict Workflow v1 Spec

## Goal
Implement **Option A**: bring the core Edict workflow semantics into Mission Control **without** cloning Edict's UI.

This should make Mission Control capable of running an Edict-style multi-stage operating model using the existing Task Board, task APIs, audit trail, reviewers, and project manager.

## Non-goals
- No 1:1 Edict UI clone
- No separate dashboard/app
- No ornate visual theme work as part of v1
- No heavy RBAC system in v1
- No full memorial/archives subsystem beyond audit-trail-level support

## Product shape
Edict v1 is a **project-level workflow mode**.

A project can be either:
- `standard`
- `edict_v1`

When a project uses `edict_v1`, Mission Control changes:
1. task stage semantics
2. allowed task transitions
3. board column labels/order
4. project badges / task badges
5. API validation for task creation and status changes

## Workflow model
### Edict stages
Edict v1 maps onto existing Mission Control task statuses as follows:

| Mission Control status | Edict stage    | Meaning |
|---|---|---|
| `inbox` | Intake | initial intake / triage |
| `assigned` | Planning | drafting / planning |
| `awaiting_owner` | Deliberation | approval / veto gate |
| `review` | Dispatch | approved and ready to dispatch |
| `in_progress` | Execution | being executed |
| `quality_review` | Review | post-execution review |
| `done` | Done | closed / memorialized |

### Stage/role semantics
Each Edict stage has an implied role label:
- Intake -> `intake lead`
- Planning -> `planner`
- Deliberation -> `deliberation lead`
- Dispatch -> `dispatcher`
- Execution -> `executor`
- Review -> `reviewer`
- Done -> `closer`

These are semantic labels for v1, not full permission principals.

## Rules / transition guards
For projects with `workflow_mode = edict_v1`, enforce:

### Allowed creation states
New tasks may only start in:
- `inbox`
- `assigned`

### No stage skipping
Tasks may only move one stage forward at a time.

Examples:
- `assigned -> in_progress` ❌
- `assigned -> awaiting_owner` ✅
- `awaiting_owner -> review` ✅
- `review -> in_progress` ✅
- `in_progress -> done` ❌
- `in_progress -> quality_review` ✅
- `quality_review -> done` ✅

### Backward movement
v1 should allow moving backward by editing status manually through the existing UI/API, but forward skipping must be blocked.

Examples:
- `awaiting_owner -> assigned` ✅
- `quality_review -> in_progress` ✅

Rationale: veto / rework should remain possible.

## Data model changes
### Projects table
Add:
- `workflow_mode TEXT NOT NULL DEFAULT 'standard'`
- `workflow_template TEXT NULL`

`workflow_template` can mirror `edict_v1` in v1 for future extensibility.

### Tasks
No new required DB columns for v1.

Use existing `status` as the stage carrier.

Optional Edict-only annotations can remain in `metadata` later if needed.

## Backend touchpoints
### New helper
Add a central workflow helper, e.g.:
- `src/lib/edict-workflow.ts`

Responsibilities:
- normalize workflow mode
- describe stage semantics
- map status -> stage/role/badge label
- provide column order/title overrides
- validate transitions

### Projects API
Update:
- `src/app/api/projects/route.ts`
- `src/app/api/projects/[id]/route.ts`

Requirements:
- accept and persist `workflow_mode`
- optionally set `workflow_template`
- return workflow metadata in project payloads

### Tasks API
Update:
- `src/app/api/tasks/route.ts`
- `src/app/api/tasks/[id]/route.ts`

Requirements:
- when project is `edict_v1`, validate initial task status
- when project is `edict_v1`, reject forward skip transitions
- return clear human-readable errors

### Validation layer
Update shared task/project schemas so `awaiting_owner` and workflow fields are valid everywhere.

## Frontend touchpoints
### Project Manager modal
Allow selecting:
- `Standard`
- `Edict v1`

Display workflow badge on Edict projects.

### Task Board
When viewing an Edict project:
- reorder columns using Edict stage order
- rename columns:
  - Inbox -> Intake
  - Assigned -> Planning
  - Awaiting Owner -> Deliberation
  - Review -> Dispatch
  - In Progress -> Execution
  - Quality Review -> Review
  - Done -> Done
- show task-level badge for stage
- optionally show role label on cards/details

When viewing non-Edict projects, preserve current behavior.

### Task detail / edit modal
When editing a task in an Edict project:
- relabel statuses with Edict wording
- keep the same underlying values

## Store / typing changes
Update shared `Task` / `Project` types so they carry:
- `project_workflow_mode`
- `project_workflow_template`
- `status` including `awaiting_owner`

## Audit / observability
For v1, use existing audit trail and comments.

Do not build a separate memorial system yet.

Future extension can add explicit events like:
- `edict.approved`
- `edict.vetoed`
- `edict.dispatched`
- `edict.memorialized`

But this is optional for v1.

## Interaction with existing systems
### Aegis
Aegis remains the post-execution quality gate.

Edict deliberation does **not** replace Aegis; it adds a **pre-execution gate**.

### Session reuse
Existing same-project session reuse work remains compatible and should help Edict execution lanes stay efficient.

## Tests
Minimum required coverage:

### Unit tests
- workflow mode normalization
- stage/role mapping
- transition guard rejects skip-ahead transitions

### API / e2e tests
- create project with `workflow_mode = edict_v1`
- update project workflow mode
- reject creating an Edict task directly in a late stage
- reject skipping forward across stages
- preserve normal behavior for standard projects

## Rollout plan
### Phase 1 (this implementation)
- project workflow mode
- helper + guard rules
- project CRUD support
- task CRUD validation
- task board relabeling/reordering
- tests

### Phase 2
- explicit Edict actions (approve / veto / dispatch)
- richer audit events
- better role-aware UI hints

### Phase 3
- stronger permissioning
- memorial/archive views
- reusable workflow presets beyond Edict

## Acceptance criteria
Edict v1 is successful when:
1. a project can be created/edited as `edict_v1`
2. the board visibly changes semantics for that project
3. tasks cannot skip required gates
4. non-Edict projects keep current behavior
5. tests/build pass

## Implementation notes
- Prefer minimal invasive changes
- Reuse existing status system
- Avoid creating a second board/pipeline system
- Keep the feature easy to revert or iterate
