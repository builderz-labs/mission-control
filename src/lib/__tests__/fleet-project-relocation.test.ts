import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedFleetProjects } from '@/lib/fleet-projects'

describe('desktop project relocation', () => {
  let db: Database.Database
  const legacyPath = '~/Dev/mission-control-desktop'
  const packagePath = '~/Dev/mission-control/apps/desktop'

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY, workspace_id INTEGER, name TEXT, slug TEXT,
        description TEXT, ticket_prefix TEXT, github_repo TEXT, status TEXT,
        created_at INTEGER, updated_at INTEGER
      );
      CREATE TABLE project_agent_assignments (
        project_id INTEGER REFERENCES projects(id), agent_name TEXT, role TEXT,
        UNIQUE(project_id, agent_name)
      );
      CREATE TABLE tasks (id INTEGER PRIMARY KEY, project_id INTEGER REFERENCES projects(id));
    `)
    seedFleetProjects(db, 1)
    seedFleetProjects(db, 2)
  })

  afterEach(() => db.close())

  it('moves the generated path in one workspace while retaining tasks and crew', () => {
    const slug = 'mission-control-desktop'
    db.prepare('UPDATE projects SET description = ? WHERE slug = ?').run(legacyPath, slug)
    const project = db.prepare('SELECT id FROM projects WHERE workspace_id = ? AND slug = ?')
      .get(1, slug) as { id: number }
    db.prepare('INSERT INTO tasks (project_id) VALUES (?)').run(project.id)
    const beforeCrew = db.prepare('SELECT * FROM project_agent_assignments WHERE project_id = ?')
      .all(project.id)

    const result = seedFleetProjects(db, 1)

    expect(result.created).toBe(0)
    expect(result.updated).toBe(1)
    expect(db.prepare('SELECT id, description FROM projects WHERE id = ?').get(project.id))
      .toEqual({ id: project.id, description: packagePath })
    expect(db.prepare('SELECT project_id FROM tasks').get()).toEqual({ project_id: project.id })
    expect(db.prepare('SELECT * FROM project_agent_assignments WHERE project_id = ?').all(project.id))
      .toEqual(beforeCrew)
    expect(db.prepare('SELECT description FROM projects WHERE workspace_id = ? AND slug = ?').get(2, slug))
      .toEqual({ description: legacyPath })
    expect(seedFleetProjects(db, 1).updated).toBe(0)
  })

  it('preserves an existing custom project description', () => {
    const custom = 'Native desktop maintenance and release tasks'
    db.prepare('UPDATE projects SET description = ? WHERE workspace_id = ? AND slug = ?')
      .run(custom, 1, 'mission-control-desktop')

    expect(seedFleetProjects(db, 1).updated).toBe(0)
    expect(db.prepare('SELECT description FROM projects WHERE workspace_id = ? AND slug = ?')
      .get(1, 'mission-control-desktop')).toEqual({ description: custom })
  })
})
