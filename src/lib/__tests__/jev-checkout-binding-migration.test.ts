import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { jevCheckoutBindingMigration } from '@/lib/jev-checkout-binding-migration'
import { FLEET_PROJECTS } from '@/lib/fleet-projects'

let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE workspaces (id INTEGER PRIMARY KEY, slug TEXT NOT NULL);
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, slug TEXT NOT NULL,
      description TEXT, FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    INSERT INTO workspaces (id,slug) VALUES (1,'default'),(2,'secondary');
  `)
})

afterEach(() => db.close())

describe('Jev checkout binding migration', () => {
  it('backfills exact fleet metadata only in the owner workspace and is idempotent', () => {
    const project = FLEET_PROJECTS[0]
    const insert = db.prepare(
      'INSERT INTO projects (id,workspace_id,slug,description) VALUES (?,?,?,?)',
    )
    insert.run(1, 1, project.slug, project.path)
    insert.run(2, 2, project.slug, project.path)

    jevCheckoutBindingMigration.up(db)
    jevCheckoutBindingMigration.up(db)

    expect(db.prepare(`
      SELECT project_id,workspace_id,root_path FROM jev_project_checkouts
    `).all()).toEqual([{ project_id: 1, workspace_id: 1, root_path: project.path }])
  })

  it('does not backfill an owner project whose free-text path does not exactly match', () => {
    const project = FLEET_PROJECTS[0]
    db.prepare('INSERT INTO projects (id,workspace_id,slug,description) VALUES (1,1,?,?)')
      .run(project.slug, `${project.path}/other`)
    jevCheckoutBindingMigration.up(db)
    expect(db.prepare('SELECT COUNT(*) AS count FROM jev_project_checkouts').get())
      .toEqual({ count: 0 })
  })
})
