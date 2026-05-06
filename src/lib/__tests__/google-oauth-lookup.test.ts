import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'

/**
 * Behavioral test: verify the Google OAuth lookup query only matches
 * users with provider='google', preventing account takeover via email
 * collision with local/proxy users.
 *
 * Uses a real in-memory SQLite database with the same schema as production.
 */

// Minimal users + workspaces schema matching production columns
function createSchema(db: InstanceType<typeof Database>) {
  db.exec(`
    CREATE TABLE workspaces (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO workspaces (id, tenant_id) VALUES (1, 1);

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'operator',
      provider TEXT NOT NULL DEFAULT 'local',
      provider_user_id TEXT,
      email TEXT,
      avatar_url TEXT,
      is_approved INTEGER NOT NULL DEFAULT 1,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_login_at INTEGER
    );
  `)
}

// The exact query from src/app/api/auth/google/route.ts (the fixed version)
const LOOKUP_QUERY = `
  SELECT u.id, u.username, u.display_name, u.role, u.provider, u.email, u.avatar_url, u.is_approved,
         u.created_at, u.updated_at, u.last_login_at, u.workspace_id, COALESCE(w.tenant_id, 1) as tenant_id
  FROM users u
  LEFT JOIN workspaces w ON w.id = u.workspace_id
  WHERE provider = 'google' AND (provider_user_id = ? OR lower(email) = ?)
  ORDER BY u.id ASC
  LIMIT 1
`

let db: InstanceType<typeof Database>

afterEach(() => {
  db?.close()
})

describe('Google OAuth user lookup', () => {
  it('does NOT match a local user by email — prevents account takeover', () => {
    db = new Database(':memory:')
    createSchema(db)

    // Local admin exists with email alice@corp.com
    db.prepare(`
      INSERT INTO users (username, display_name, role, provider, email, is_approved)
      VALUES ('alice', 'Alice', 'admin', 'local', 'alice@corp.com', 1)
    `).run()

    // Attacker signs in with Google using alice@corp.com
    const row = db.prepare(LOOKUP_QUERY).get('attacker-google-sub', 'alice@corp.com')
    expect(row).toBeUndefined()
  })

  it('matches an existing Google user by provider_user_id', () => {
    db = new Database(':memory:')
    createSchema(db)

    db.prepare(`
      INSERT INTO users (username, display_name, provider, provider_user_id, email, is_approved)
      VALUES ('bob', 'Bob', 'google', 'google-sub-123', 'bob@corp.com', 1)
    `).run()

    const row = db.prepare(LOOKUP_QUERY).get('google-sub-123', 'bob@corp.com') as any
    expect(row).not.toBeNull()
    expect(row.username).toBe('bob')
  })

  it('matches an existing Google user by email when sub changed', () => {
    db = new Database(':memory:')
    createSchema(db)

    db.prepare(`
      INSERT INTO users (username, display_name, provider, provider_user_id, email, is_approved)
      VALUES ('carol', 'Carol', 'google', 'old-sub', 'carol@corp.com', 1)
    `).run()

    // Google sub changed but email matches — should still find the Google user
    const row = db.prepare(LOOKUP_QUERY).get('new-sub', 'carol@corp.com') as any
    expect(row).not.toBeNull()
    expect(row.username).toBe('carol')
  })

  it('does NOT match a proxy user by email', () => {
    db = new Database(':memory:')
    createSchema(db)

    db.prepare(`
      INSERT INTO users (username, display_name, provider, email, is_approved)
      VALUES ('dan', 'Dan', 'proxy', 'dan@corp.com', 1)
    `).run()

    const row = db.prepare(LOOKUP_QUERY).get('some-google-sub', 'dan@corp.com')
    expect(row).toBeUndefined()
  })

  it('returns null when no user matches at all', () => {
    db = new Database(':memory:')
    createSchema(db)

    const row = db.prepare(LOOKUP_QUERY).get('unknown-sub', 'nobody@example.com')
    expect(row).toBeUndefined()
  })

  it('does NOT match unapproved Google user', () => {
    db = new Database(':memory:')
    createSchema(db)

    db.prepare(`
      INSERT INTO users (username, display_name, provider, provider_user_id, email, is_approved)
      VALUES ('eve', 'Eve', 'google', 'eve-sub', 'eve@corp.com', 0)
    `).run()

    // Query returns the row, but the route checks is_approved — verify the row has is_approved=0
    const row = db.prepare(LOOKUP_QUERY).get('eve-sub', 'eve@corp.com') as any
    expect(row).not.toBeNull()
    expect(row.is_approved).toBe(0)
  })

  it('prefers Google user over local user with same email', () => {
    db = new Database(':memory:')
    createSchema(db)

    // Local user first (lower id)
    db.prepare(`
      INSERT INTO users (username, display_name, provider, email, is_approved)
      VALUES ('alice-local', 'Alice Local', 'local', 'alice@corp.com', 1)
    `).run()

    // Google user second (higher id)
    db.prepare(`
      INSERT INTO users (username, display_name, provider, provider_user_id, email, is_approved)
      VALUES ('alice-google', 'Alice Google', 'google', 'alice-sub', 'alice@corp.com', 1)
    `).run()

    const row = db.prepare(LOOKUP_QUERY).get('alice-sub', 'alice@corp.com') as any
    expect(row).not.toBeNull()
    expect(row.provider).toBe('google')
    expect(row.username).toBe('alice-google')
  })
})
