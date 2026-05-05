# Mission Control Implementation Blockers

## TASK 4: Activate memory-review-weekly cron job

**Date**: 2026-05-02

**Blocker**: The cron system (`src/app/api/cron/route.ts`) reads and writes to
`~/.openclaw/cron/jobs.json` (the OpenClaw daemon's config file). There is no
standalone MC-native cron table in the SQLite database.

**Implications**:
- Creating a cron job via `mc cron create` writes to `~/.openclaw/cron/jobs.json`,
  which is only processed when the OpenClaw daemon is running.
- Activating the job silently in test/offline context would create a dangling entry
  that never fires.
- `SCHEDULES.md` says: "No schedule activates automatically. Owner or Systems
  Curator must enable it explicitly." — this is consistent.

**What was implemented instead**:
- Created `scripts/mc-memory-review.cjs` — a standalone observe-only script
  that reads the SQLite memory store directly and appends results to
  `logs/mc/memory-review.jsonl`.
- `SCHEDULES.md` has **not** been reconciled yet. It still describes the
  planned Mission Control cron model and should be updated separately once the
  scheduling/runtime story is unified.
- The script is idempotent: running twice in the same UTC day is a no-op.
- Added `"mc:memory-review": "node scripts/mc-memory-review.cjs"` to package.json.
- To wire into OpenClaw cron once the daemon is running:
  ```bash
  mc cron create --name memory-review-weekly --schedule "0 9 * * 1" \
    --agent systems-curator --task-template memory-review
  ```

**Tests**: `src/lib/__tests__/mc-memory-review.test.ts` — covers offline path,
idempotency, and log format.
