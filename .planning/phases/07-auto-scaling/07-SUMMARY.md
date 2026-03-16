# Phase 7 Summary: Auto-Scaling

## What was built

### Plan 07-01: Scaling Schema + Engine
- **2 migrations:** `scaling_policies` table (min/max agents, thresholds, cooldown, idle_timeout, auto_approve, agent_template) + `scaling_events` table (policy_id FK, event_type, status, reason, metrics_snapshot)
- **Scaling engine:** `scaling-engine.ts` — lazy evaluation (no setInterval), cooldown enforcement, global agent cap (`MC_GLOBAL_AGENT_CAP` env), template-based spawning
- **6 exported functions:** `getGlobalAgentCap`, `getScalingMetrics`, `evaluateScaling`, `executeScaleUp`, `executeScaleDown`, `createScalingEvent` (internal)
- **16 unit tests** with SQL-fragment-matching mock pattern

### Plan 07-02: Scaling API Routes
- **5 API route files:** policies CRUD (list, create, get, update, delete), evaluate (trigger + auto-approve), events (list, get, approve/reject)
- **Zod validation:** threshold ranges, min/max agent validation, auto_approve boolean→integer transform
- **71 unit tests**

### Plan 07-03: Scaling Monitor Panel + E2E
- **Scaling panel:** 3-tab dashboard (overview metrics, policies CRUD + evaluate, events with approve/reject)
- **ContentRouter registration:** `case 'scaling'` in page.tsx
- **11 E2E tests:** policies CRUD, validation (thresholds, min>max), evaluate, events list, 401 auth checks

## Quality gate

- **Unit tests:** 85 files, 1161 tests, 0 failures
- **E2E tests:** 753 passed, 0 failed, 1 skipped
- **TypeScript:** 0 errors

## Key decisions

- Lazy evaluation (no timers) — serverless-safe, evaluation triggered via API only
- Global agent cap separate from per-policy max_agents — defense in depth
- Scaling policy manual cascade delete — consistent with debate pattern
- SQL-fragment-matching mock pattern for DB-heavy unit tests — more robust than sequential `mockReturnValueOnce`
- `scale_up_threshold` stored as 0-1 ratio but compared against integer queue depth — design quirk noted
