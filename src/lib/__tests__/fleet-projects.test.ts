import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { DISCOVERED_PROJECTS, FLEET_PROJECTS, seedFleetProjects } from '@/lib/fleet-projects'
import { FLEET_AGENT_NAMES } from '@/lib/fleet-agents'

describe('fleet projects', () => {
  it('covers the 18 FLEET-MAP checkouts with unique slugs and prefixes', () => {
    expect(FLEET_PROJECTS).toHaveLength(18)
    const slugs = FLEET_PROJECTS.map((row) => row.slug)
    const prefixes = FLEET_PROJECTS.map((row) => row.ticketPrefix)
    expect(new Set(slugs).size).toBe(18)
    expect(new Set(prefixes).size).toBe(18)
    expect(FLEET_PROJECTS.every((row) => row.path.startsWith('~/Dev/'))).toBe(true)
  })

  it('sets github_repo only for tylerdevries22-afk remotes', () => {
    const actz = FLEET_PROJECTS.find((row) => row.slug === 'actz-may')
    const vault = FLEET_PROJECTS.find((row) => row.slug === 'omnia-vault')
    const desktop = FLEET_PROJECTS.find((row) => row.slug === 'mission-control-desktop')
    expect(actz?.githubRepo).toBe('tylerdevries22-afk/actz-may')
    expect(vault?.githubRepo).toBeNull()
    expect(desktop?.githubRepo).toBeNull()
    expect(desktop?.path).toBe('~/Dev/mission-control/apps/desktop')
  })

  it('keeps discovered extra projects unique from the FLEET-MAP set', () => {
    const fleetSlugs = new Set(FLEET_PROJECTS.map((row) => row.slug))
    const extraSlugs = DISCOVERED_PROJECTS.map((row) => row.slug)
    expect(new Set(extraSlugs).size).toBe(extraSlugs.length)
    expect(extraSlugs.every((slug) => !fleetSlugs.has(slug))).toBe(true)
  })

  it('inserts missing projects and assigns the five identities', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        description TEXT,
        ticket_prefix TEXT NOT NULL,
        github_repo TEXT,
        status TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE TABLE project_agent_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        agent_name TEXT NOT NULL,
        role TEXT,
        UNIQUE(project_id, agent_name)
      );
    `)
    const first = seedFleetProjects(db, 1)
    expect(first.created).toBe(FLEET_PROJECTS.length + DISCOVERED_PROJECTS.length)
    const second = seedFleetProjects(db, 1)
    expect(second.created).toBe(0)
    const assigned = db.prepare(
      'SELECT COUNT(DISTINCT agent_name) AS n FROM project_agent_assignments',
    ).get() as { n: number }
    expect(assigned.n).toBe(FLEET_AGENT_NAMES.length)
    db.prepare(`
      INSERT INTO projects (workspace_id, name, slug, ticket_prefix, status, created_at, updated_at)
      VALUES (1, 'General', 'general', 'GEN', 'active', 1, 1)
    `).run()
    const withGeneral = seedFleetProjects(db, 1)
    expect(withGeneral.created).toBe(0)
    const generalCrew = db.prepare(
      `SELECT COUNT(*) AS n FROM project_agent_assignments
       WHERE project_id = (SELECT id FROM projects WHERE slug = 'general')`,
    ).get() as { n: number }
    expect(generalCrew.n).toBe(FLEET_AGENT_NAMES.length)
    db.close()
  })
})
