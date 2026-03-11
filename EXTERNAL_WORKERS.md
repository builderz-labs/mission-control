# External Workers Control Plane

Hybrid OpenClaw-native design:

- **Control plane:** Mission Control DB + API + scheduler
- **Execution plane:** git worktrees + tmux + Codex/Claude CLI
- **Source of truth:** `external_workers` registry table
- **Babysitting cadence:** Mission Control scheduler task `external_worker_babysit` every 60s

## Registry fields

Each worker registry row stores:

- task_id
- role_owner
- tool
- model
- worktree_path
- tmux_session
- branch
- started_at
- status
- retry_count
- latest_artifact
- latest_note
- prompt_path
- retry_packet_path
- log_path
- done_gate_passed

## Status classes

The babysitter classifies each worker as one of:

- `running`
- `blocked`
- `needs_steer`
- `retryable`
- `ready_for_review`
- `done`

Rules:

- registry is authoritative
- tmux liveness is checked, but not sufficient on its own
- a tmux exit is **not** success unless the done gate passes
- retries are manual and require a Ralph Loop V2 retry packet

## Scripts / entry points

- `pnpm workers:spawn -- --role-owner jim --tool codex --task-title "..." --prompt "..."`
- `pnpm workers:babysit`
- `pnpm workers:list`
- `pnpm workers:steer -- --worker-id 12 --note "Narrow scope to src/lib only"`
- `node --experimental-strip-types scripts/external-worker-control.mjs retry-packet --worker-id 12 --diagnosis "..." --corrected-context "..." --narrowed-scope "..." --do-not-repeat "foo||bar"`

## API

- `GET /api/workers`
- `POST /api/workers` with `{ action: "spawn" | "babysit", ... }`
- `GET /api/workers/:id`
- `POST /api/workers/:id` with `{ action: "steer" | "retry-packet", ... }`
