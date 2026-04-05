#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="${MC_DB_PATH:-$ROOT_DIR/.data/mission-control.db}"
DRY_RUN="${1:-1}"

if [[ "$DRY_RUN" != "0" && "$DRY_RUN" != "1" ]]; then
  echo "Usage: $0 [0|1]"
  echo "  0 = apply fixes"
  echo "  1 = dry-run (default)"
  exit 1
fi

if [[ ! -f "$DB_PATH" ]]; then
  echo "Database not found: $DB_PATH"
  exit 1
fi

CANDIDATE_SQL=$(cat <<'SQL'
WITH normalized AS (
  SELECT
    id,
    workspace_id,
    title,
    status,
    COALESCE(dispatch_attempts, 0) AS dispatch_attempts,
    CASE
      WHEN json_valid(COALESCE(metadata, '{}')) THEN COALESCE(metadata, '{}')
      ELSE '{}'
    END AS metadata_json
  FROM tasks
  WHERE status IN ('owner_gate_review', 'verify', 'recovering', 'awaiting_owner', 'in_progress')
),
candidates AS (
  SELECT
    id,
    workspace_id,
    title,
    status,
    dispatch_attempts,
    CAST(COALESCE(json_extract(metadata_json, '$.caio_reassign_count'), 0) AS INTEGER) AS caio_reassign_count,
    CAST(
      CASE
        WHEN json_extract(metadata_json, '$.stale_recovery_count') IS NULL THEN 0
        ELSE json_extract(metadata_json, '$.stale_recovery_count')
      END AS INTEGER
    ) AS stale_recovery_count,
    CAST(COALESCE(json_extract(metadata_json, '$.owner_candidate'), 0) AS INTEGER) AS owner_candidate,
    json_extract(metadata_json, '$.owner_required_reason') AS owner_required_reason
  FROM normalized
  WHERE
    CAST(COALESCE(json_extract(metadata_json, '$.owner_candidate'), 0) AS INTEGER) = 1
    OR json_extract(metadata_json, '$.owner_required_reason') IS NOT NULL
    OR CAST(COALESCE(json_extract(metadata_json, '$.caio_reassign_count'), 0) AS INTEGER) >= 6
    OR (
      CASE
        WHEN json_extract(metadata_json, '$.stale_recovery_count') IS NULL THEN 0
        ELSE json_extract(metadata_json, '$.stale_recovery_count')
      END
    ) >= 3
    OR dispatch_attempts >= 5
)
SELECT
  id,
  title,
  status,
  dispatch_attempts,
  caio_reassign_count,
  stale_recovery_count,
  owner_candidate,
  owner_required_reason
FROM candidates
ORDER BY id;
SQL
)

if [[ "$DRY_RUN" == "1" ]]; then
  sqlite3 "$DB_PATH" "$CANDIDATE_SQL"
  exit 0
fi

APPLY_SQL=$(cat <<'SQL'
BEGIN;
DROP TABLE IF EXISTS temp._owner_gate_loop_candidates;
CREATE TEMP TABLE _owner_gate_loop_candidates AS
WITH normalized AS (
  SELECT
    id,
    workspace_id,
    COALESCE(dispatch_attempts, 0) AS dispatch_attempts,
    CASE
      WHEN json_valid(COALESCE(metadata, '{}')) THEN COALESCE(metadata, '{}')
      ELSE '{}'
    END AS metadata_json
  FROM tasks
  WHERE status IN ('owner_gate_review', 'verify', 'recovering', 'awaiting_owner', 'in_progress')
)
SELECT
  id,
  workspace_id
FROM normalized
WHERE
  CAST(COALESCE(json_extract(metadata_json, '$.owner_candidate'), 0) AS INTEGER) = 1
  OR json_extract(metadata_json, '$.owner_required_reason') IS NOT NULL
  OR CAST(COALESCE(json_extract(metadata_json, '$.caio_reassign_count'), 0) AS INTEGER) >= 6
  OR (
    CASE
      WHEN json_extract(metadata_json, '$.stale_recovery_count') IS NULL THEN 0
      ELSE json_extract(metadata_json, '$.stale_recovery_count')
    END
  ) >= 3
  OR dispatch_attempts >= 5;

UPDATE tasks
SET
  status = 'needs_owner',
  assigned_to = 'owner',
  error_message = 'Automatic owner escalation to prevent infinite owner-gate/recovery loop.',
  metadata = json_set(
    json_set(
      CASE
        WHEN json_valid(COALESCE(metadata, '{}')) THEN COALESCE(metadata, '{}')
        ELSE '{}'
      END,
      '$.owner_candidate', 1,
        '$.harness.step', 'needs_owner'
    ),
    '$.owner_required_reason',
    COALESCE(
      json_extract(CASE
        WHEN json_valid(COALESCE(metadata, '{}')) THEN COALESCE(metadata, '{}')
        ELSE '{}'
      END, '$.owner_required_reason'),
      'Automatic owner escalation: task met loop-protection thresholds.'
    ),
    '$.owner_queue_kind',
    'auto_guard',
    '$.owner_queue_entered_at',
    CAST(strftime('%s', 'now') AS INTEGER)
  )
WHERE id IN (SELECT id FROM _owner_gate_loop_candidates);

INSERT INTO comments (task_id, author, content, created_at, workspace_id)
SELECT
  id,
  'system',
  'Automatic owner escalation: moved to needs_owner by owner-gate loop breaker.',
  strftime('%s', 'now'),
  workspace_id
FROM _owner_gate_loop_candidates;

DROP TABLE IF EXISTS temp._owner_gate_loop_candidates;
COMMIT;
SQL
)

sqlite3 "$DB_PATH" "$APPLY_SQL"

echo "Escalated $(sqlite3 "$DB_PATH" "SELECT changes();") task(s)."
