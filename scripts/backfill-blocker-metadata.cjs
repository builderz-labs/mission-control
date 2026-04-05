#!/usr/bin/env node

const path = require('path')
const Database = require('better-sqlite3')

const ROOT = path.resolve(__dirname, '..')
const DB_PATH = path.join(ROOT, '.data', 'mission-control.db')

function parseMetadata(raw) {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function stringifyMetadata(meta) {
  return JSON.stringify(meta || {})
}

function nowTs() {
  return Math.floor(Date.now() / 1000)
}

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

function main() {
  const db = new Database(DB_PATH)
  const rows = db.prepare(`
    SELECT id, status, metadata, error_message
    FROM tasks
    WHERE status IN ('blocked_approval', 'blocked_env', 'needs_owner')
    ORDER BY updated_at ASC
  `).all()

  let updated = 0
  const update = db.prepare('UPDATE tasks SET metadata = ?, updated_at = ? WHERE id = ?')

  const tx = db.transaction(() => {
    for (const row of rows) {
      const meta = parseMetadata(row.metadata)
      const harness = meta.harness && typeof meta.harness === 'object' ? meta.harness : {}
      const blockers = ensureArray(harness.blockers)
      let changed = false

      if (row.status === 'blocked_approval') {
        if (meta.blocker_class !== 'approval') {
          meta.blocker_class = 'approval'
          changed = true
        }
        if (harness.step !== 'blocked_approval') {
          harness.step = 'blocked_approval'
          changed = true
        }
        if (!blockers.some((b) => b && b.class === 'approval')) {
          blockers.push({
            class: 'approval',
            reason: row.error_message || 'Approval required',
          })
          changed = true
        }
      }

      if (row.status === 'blocked_env') {
        if (meta.blocker_class !== 'environment') {
          meta.blocker_class = 'environment'
          changed = true
        }
        if (harness.step !== 'blocked_env') {
          harness.step = 'blocked_env'
          changed = true
        }
        if (!blockers.some((b) => b && b.class === 'environment')) {
          blockers.push({
            class: 'environment',
            reason: row.error_message || 'Environment unavailable',
          })
          changed = true
        }
      }

      if (row.status === 'needs_owner') {
        if (!meta.owner_required_reason) {
          meta.owner_required_reason = 'credential_or_human_only_action'
          changed = true
        }
        if (!meta.owner_action) {
          meta.owner_action = 'manual_owner_intervention'
          changed = true
        }
        if (harness.step !== 'needs_owner') {
          harness.step = 'needs_owner'
          changed = true
        }
        if (!blockers.some((b) => b && b.class === 'owner')) {
          blockers.push({
            class: 'owner',
            reason: row.error_message || meta.owner_required_reason,
          })
          changed = true
        }
      }

      if (!changed) continue

      harness.blockers = blockers
      meta.harness = harness
      update.run(stringifyMetadata(meta), nowTs(), row.id)
      updated++
    }
  })

  tx()
  console.log(JSON.stringify({ ok: true, scanned: rows.length, updated }))
}

main()
