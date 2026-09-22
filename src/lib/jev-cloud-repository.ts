import type Database from 'better-sqlite3'
import { redactJevSetupValue } from '@/lib/jev-setup-redaction'
import { hashJevCloudPayload } from '@/lib/jev-cloud-integrity'

type Db = Database.Database
export interface JevCloudEvent {
  sequence: number; event_id: string; workspace_id: number; entity_type: string; entity_id: string
  operation: 'upsert' | 'delete'; payload: string | null; attempts: number; created_at: number
}

const sources: Record<string, string> = {
  policies: 'SELECT * FROM jev_policies WHERE id=? AND workspace_id=?',
  evaluations: `SELECT id,workspace_id,project_id,policy_id,status,model_requested,model_resolved,
    questions,answers,usage_input_tokens,usage_output_tokens,latency_ms,request_id,
    state_length,error_code,created_at,completed_at,idempotency_key,policy_name_snapshot,
    policy_configuration_snapshot FROM jev_evaluations WHERE id=? AND workspace_id=?`,
  setup_sessions: 'SELECT * FROM jev_setup_sessions WHERE id=? AND workspace_id=?',
  setup_messages: 'SELECT * FROM jev_setup_messages WHERE id=? AND workspace_id=?',
  setup_revisions: 'SELECT * FROM jev_setup_revisions WHERE id=? AND workspace_id=?',
  setup_revision_policies: 'SELECT * FROM jev_setup_revision_policies WHERE id=? AND workspace_id=?',
}
const jsonFields = new Set([
  'questions', 'answers', 'configuration', 'policy_configuration_snapshot', 'draft', 'content',
])

export function prepareJevCloudPayload(event: JevCloudEvent, db: Db): string {
  if (event.payload) return event.payload
  const source = sources[event.entity_type]
  if (!source) throw new Error('JEV_CLOUD_ENTITY_INVALID')
  const origin = db.prepare('SELECT instance_id FROM jev_cloud_origin WHERE singleton=1').get() as { instance_id: string }
  const row = event.operation === 'delete' ? null
    : db.prepare(source).get(event.entity_id, event.workspace_id) as Record<string, unknown> | undefined
  const snapshot = row ? Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (!jsonFields.has(key) || typeof value !== 'string') return [key, value]
    try { return [key, JSON.parse(value)] } catch { return [key, null] }
  })) : null
  const redacted = { schema_version: 1, snapshot: redactJevSetupValue(snapshot) }
  const payload = JSON.stringify({ origin_instance_id: origin.instance_id, event_id: event.event_id,
    sequence: event.sequence, workspace_id: event.workspace_id, entity_type: event.entity_type,
    entity_id: event.entity_id, operation: row ? 'upsert' : 'delete',
    occurred_at: new Date(event.created_at * 1000).toISOString(),
    payload: redacted, payload_sha256: hashJevCloudPayload(redacted),
  })
  // Freeze the exact redacted body before the first request for replay after a crash.
  db.prepare('UPDATE jev_cloud_outbox SET payload=? WHERE event_id=? AND payload IS NULL').run(payload, event.event_id)
  return (db.prepare('SELECT payload FROM jev_cloud_outbox WHERE event_id=?').get(event.event_id) as { payload: string }).payload
}

export function getJevCloudQueueStatus(workspaceId: number, db: Db) {
  const row = db.prepare(`SELECT
    SUM(CASE WHEN synced_at IS NULL THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN synced_at IS NOT NULL THEN 1 ELSE 0 END) AS synced,
    MAX(synced_at) AS lastSyncedAt FROM jev_cloud_outbox WHERE workspace_id=?`).get(workspaceId) as {
      pending: number | null; synced: number | null; lastSyncedAt: number | null
    }
  const error = db.prepare(`SELECT error_code FROM jev_cloud_outbox
    WHERE workspace_id=? AND synced_at IS NULL AND error_code IS NOT NULL ORDER BY sequence LIMIT 1`)
    .get(workspaceId) as { error_code: string } | undefined
  return { pending: row.pending ?? 0, synced: row.synced ?? 0, lastSyncedAt: row.lastSyncedAt,
    errorCode: error?.error_code ?? null }
}
