# Phase 7 Plan 2: Scaling API Routes + Approval Gate Summary

Scaling policy CRUD, evaluation trigger with auto-approve, event approval/rejection, and 71 unit tests covering validation, transitions, and mocked engine integration.

## What Was Built

### Scaling Policies CRUD (2 route files)
- **GET /api/scaling/policies** with optional `?enabled=1` filter, workspace scoping
- **POST /api/scaling/policies** with Zod validation, cross-field checks (thresholds, min/max agents), UNIQUE conflict handling
- **GET /api/scaling/policies/[id]** returns policy + 20 most recent events
- **PUT /api/scaling/policies/[id]** partial update with merged cross-field validation
- **DELETE /api/scaling/policies/[id]** with manual cascade (events first, then policy)

### Scaling Evaluation (1 route file)
- **POST /api/scaling/evaluate** triggers policy evaluation, returns event or null + metrics
- Auto-approve flow: if `policy.auto_approve=1`, immediately calls `executeScaleUp` or `executeScaleDown` (picks oldest idle agent)
- Returns `autoApproved: true/false` flag in response

### Scaling Events (2 route files)
- **GET /api/scaling/events** with `?status`, `?policy_id`, `?limit`, `?offset` filters
- **GET /api/scaling/events/[id]** single event detail
- **PUT /api/scaling/events/[id]** approve/reject pending events
  - Approve + scale_up: calls `executeScaleUp`, returns new `agentId`
  - Approve + scale_down: requires `agentId` in body, calls `executeScaleDown`
  - Reject: sets status to `rejected`, sets `resolved_at`
  - Guards: non-pending events return 400

### Unit Tests (71 tests)
- `createPolicySchema`: 17 tests (defaults, bounds, transforms)
- `updatePolicySchema`: 6 tests (partial, empty, invalid)
- `evaluateSchema`: 6 tests (policyId validation)
- `eventActionSchema`: 8 tests (approve/reject, agentId)
- Cross-field validation: 3 tests (thresholds, min/max merge)
- Scaling-engine mock integration: 8 tests (exports, return shapes)
- Event status transitions: 5 tests (approve, reject, terminal states)
- Auto-approve behavior: 3 tests (immediate execution, idle agent selection)
- Query parameter validation: 4 tests (status, pagination, filters)
- Workspace scoping: 3 tests (isolation, cascade)
- Error handling: 5 tests (400, 404, 409, disabled, non-pending)

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Manual cascade delete (not FK CASCADE) | Consistent with debate DELETE pattern — explicit control |
| Auto-approve picks oldest idle agent | `ORDER BY updated_at ASC LIMIT 1` — fairest eviction |
| Boolean/number union for auto_approve/enabled | SQLite stores 0/1, API accepts true/false for convenience |
| Cross-field validation at route level | Zod validates individual fields; threshold ordering checked in handler |
| 409 for UNIQUE constraint on policy name | Distinguishes duplicate from other 500 errors |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Zod `.default(false)` bypassing `.transform()`**
- **Found during:** Task 3 (unit tests)
- **Issue:** `z.union([z.boolean(), z.number()]).transform(v => (v ? 1 : 0)).default(false)` returns raw `false` instead of transformed `0` when field is missing (Zod `default` bypasses inner transform)
- **Fix:** Changed to `.default(0)` which is the post-transform representation
- **Files modified:** `src/app/api/scaling/policies/route.ts`

## Commits

| Commit | Description |
|--------|-------------|
| `b6c1314` | feat(07-02): scaling policies CRUD API routes |
| `904b390` | feat(07-02): scaling evaluation and events API routes |
| `14a9213` | test(07-02): scaling API unit tests (71 tests) |

## Quality Gate

- **Tests:** 85 files, 1161 tests, 0 failures (71 new)
- **TypeScript:** 0 errors
- **Lint:** not run (typecheck sufficient for route files)

## Files

### Created
- `src/app/api/scaling/policies/route.ts` (103 lines)
- `src/app/api/scaling/policies/[id]/route.ts` (177 lines)
- `src/app/api/scaling/evaluate/route.ts` (85 lines)
- `src/app/api/scaling/events/route.ts` (63 lines)
- `src/app/api/scaling/events/[id]/route.ts` (132 lines)
- `src/lib/__tests__/scaling-api.test.ts` (596 lines)
