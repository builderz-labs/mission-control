/**
 * Creates a temporary audit test user in the running DB.
 * Usage: node scripts/create-audit-user.mjs
 */
import { randomBytes, scryptSync } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const require = createRequire(import.meta.url)

const dbPath = resolve(__dirname, '../.data/mission-control.db')

// Dynamically require better-sqlite3
let Database
try {
  Database = require('better-sqlite3')
} catch {
  console.error('better-sqlite3 not found. Run pnpm install first.')
  process.exit(1)
}

const AUDIT_USER = 'audit-e2e-test'
const AUDIT_PASS = 'audit-test-pass-2026!'

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32, { N: 16384 }).toString('hex')
  return `${salt}:${hash}`
}

const db = new Database(dbPath)

// Remove stale audit user if exists
db.prepare("DELETE FROM users WHERE username = ?").run(AUDIT_USER)

// Ensure workspace 1 exists
const ws = db.prepare("SELECT id FROM workspaces WHERE id = 1").get()
if (!ws) {
  db.prepare("INSERT OR IGNORE INTO workspaces (id, name) VALUES (1, 'Default')").run()
}

// Ensure tenant 1 exists
const tenant = db.prepare("SELECT id FROM tenants WHERE id = 1").get()
if (!tenant) {
  db.prepare("INSERT OR IGNORE INTO tenants (id, name) VALUES (1, 'Default')").run()
}

const passwordHash = hashPassword(AUDIT_PASS)

db.prepare(`
  INSERT INTO users (username, display_name, password_hash, role, workspace_id)
  VALUES (?, ?, ?, 'admin', 1)
`).run(AUDIT_USER, 'Audit E2E Test', passwordHash)

console.log(`Created audit user: ${AUDIT_USER}`)
console.log(`Password: ${AUDIT_PASS}`)

db.close()
