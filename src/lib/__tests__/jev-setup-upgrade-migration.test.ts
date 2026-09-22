// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '@/lib/migrations'
import { jevSetupUpgradeMigration } from '@/lib/jev-setup-upgrade-migration'

let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  db.exec(`
    INSERT INTO users(id,username,display_name,password_hash,role,workspace_id)
      VALUES(301,'upgrade-owner','Owner','unused','operator',1);
    INSERT INTO projects(id,workspace_id,name,slug,ticket_prefix)
      VALUES(391,1,'Upgrade','upgrade','UPG');
    INSERT INTO jev_policies(id,workspace_id,project_id,name,questions,created_by)
      VALUES(401,1,391,'Existing policy','{}','upgrade-owner');
    INSERT INTO jev_setup_sessions(id,workspace_id,project_id,created_by_user_id,title,provider,model)
      VALUES('existing-session',1,391,301,'Existing goal','claude-cli','haiku');
    INSERT INTO jev_setup_revisions(id,workspace_id,session_id,revision_no,draft,configuration,provider,model)
      VALUES(501,1,'existing-session',1,'{}','{}','claude-cli','haiku');
    DROP TABLE jev_setup_revision_policies;
  `)
  db.prepare('DELETE FROM schema_migrations WHERE id=?').run(jevSetupUpgradeMigration.id)
})

afterEach(() => db.close())

function insertLink() {
  return db.prepare(`INSERT INTO jev_setup_revision_policies
    (workspace_id,session_id,revision_id,policy_id,project_id,policy_name)
    VALUES(1,'existing-session',501,401,391,'Existing policy')`).run()
}

describe('upgrade from an already-migrated early Jev installation', () => {
  it('repairs a missing link table despite 068 and 069 already being applied', () => {
    const previous = db.prepare('SELECT * FROM jev_setup_revisions').all()
    const queued = db.prepare('SELECT COUNT(*) AS count FROM jev_cloud_outbox').get()
    runMigrations(db)
    expect(db.prepare('SELECT * FROM jev_setup_revisions').all()).toEqual(previous)
    expect(db.prepare('SELECT COUNT(*) AS count FROM jev_cloud_outbox').get()).toEqual(queued)
    expect(db.prepare('SELECT id FROM schema_migrations WHERE id=?').get(jevSetupUpgradeMigration.id))
      .toEqual({ id: jevSetupUpgradeMigration.id })
    expect(() => insertLink()).not.toThrow()
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('queues insert, update and delete link events without duplicating existing events on replay', () => {
    runMigrations(db)
    const link = insertLink()
    db.prepare('UPDATE jev_setup_revision_policies SET policy_name=? WHERE id=?')
      .run('Reviewed policy', link.lastInsertRowid)
    const before = db.prepare('SELECT * FROM jev_cloud_outbox ORDER BY sequence').all()
    db.transaction(() => jevSetupUpgradeMigration.up(db))()
    expect(db.prepare('SELECT * FROM jev_cloud_outbox ORDER BY sequence').all()).toEqual(before)
    db.prepare('DELETE FROM jev_setup_revision_policies WHERE id=?').run(link.lastInsertRowid)
    expect(db.prepare(`SELECT operation FROM jev_cloud_outbox
      WHERE entity_type='setup_revision_policies' ORDER BY sequence`).all())
      .toEqual([{ operation: 'upsert' }, { operation: 'upsert' }, { operation: 'delete' }])
  })

  it('keeps uniqueness and foreign-key restrictions after repair', () => {
    runMigrations(db)
    insertLink()
    expect(() => insertLink()).toThrow()
    expect(() => db.prepare(`UPDATE jev_setup_revision_policies SET session_id=?`)
      .run('missing-session')).toThrow()
    expect(() => db.prepare(`UPDATE jev_setup_revision_policies SET revision_id=?`)
      .run(9999)).toThrow()
    expect(db.prepare('SELECT COUNT(*) AS count FROM jev_setup_revision_policies').get())
      .toEqual({ count: 1 })
  })

  it('rolls the repair back atomically if its enclosing transaction fails', () => {
    expect(() => db.transaction(() => {
      jevSetupUpgradeMigration.up(db)
      throw new Error('Synthetic interruption')
    })()).toThrow('Synthetic interruption')
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name='jev_setup_revision_policies'`).get())
      .toBeUndefined()
    runMigrations(db)
    expect(() => insertLink()).not.toThrow()
  })
})
