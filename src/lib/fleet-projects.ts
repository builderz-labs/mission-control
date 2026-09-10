import type { Database as SqliteDatabase } from 'better-sqlite3'
import { FLEET_AGENT_NAMES } from './fleet-agents'

export interface FleetProjectSpec {
  name: string
  slug: string
  ticketPrefix: string
  path: string
  githubRepo: string | null
}

export const FLEET_PROJECTS: FleetProjectSpec[] = [
  { name: 'PhoneTwin-Studio', slug: 'phonetwin-studio', ticketPrefix: 'PTS', path: '~/Dev/PhoneTwin-Studio', githubRepo: 'tylerdevries22-afk/PhoneTwin-Studio' },
  { name: 'actz-may', slug: 'actz-may', ticketPrefix: 'ACTZ', path: '~/Dev/actz-may', githubRepo: 'tylerdevries22-afk/actz-may' },
  { name: 'ammari-dental', slug: 'ammari-dental', ticketPrefix: 'AMD', path: '~/Dev/ammari-dental', githubRepo: 'tylerdevries22-afk/ammari-dental' },
  { name: 'app-zap', slug: 'app-zap', ticketPrefix: 'AZP', path: '~/Dev/app-zap', githubRepo: 'tylerdevries22-afk/app-zap' },
  { name: 'appliance-diagnostic-systems', slug: 'appliance-diagnostic-systems', ticketPrefix: 'ADS', path: '~/Dev/appliance-diagnostic-systems', githubRepo: null },
  { name: 'authorized-network-observatory', slug: 'authorized-network-observatory', ticketPrefix: 'ANO', path: '~/Dev/authorized-network-observatory', githubRepo: null },
  { name: 'blender_mcp', slug: 'blender-mcp', ticketPrefix: 'BMCP', path: '~/Dev/blender_mcp', githubRepo: null },
  { name: 'coffee-story', slug: 'coffee-story', ticketPrefix: 'CSF', path: '~/Dev/coffee-story', githubRepo: 'tylerdevries22-afk/coffee-story' },
  { name: 'elevate-web-dev-solutions', slug: 'elevate-web-dev-solutions', ticketPrefix: 'EWDS', path: '~/Dev/elevate-web-dev-solutions', githubRepo: 'tylerdevries22-afk/elevate-web-dev-solutions' },
  { name: 'faithful-heart-healing-oasis', slug: 'faithful-heart-healing-oasis', ticketPrefix: 'FHHO', path: '~/Dev/faithful-heart-healing-oasis', githubRepo: 'tylerdevries22-afk/faithful-heart-healing-oasis' },
  { name: 'goose', slug: 'goose', ticketPrefix: 'GOOSE', path: '~/Dev/goose', githubRepo: null },
  { name: 'marketing-engine', slug: 'marketing-engine', ticketPrefix: 'MKTE', path: '~/Dev/marketing-engine', githubRepo: 'tylerdevries22-afk/marketing-engine' },
  { name: 'mfsuperior-crm', slug: 'mfsuperior-crm', ticketPrefix: 'MFSC', path: '~/Dev/mfsuperior-crm', githubRepo: 'tylerdevries22-afk/mfsuperior-crm' },
  { name: 'mission-control', slug: 'mission-control', ticketPrefix: 'MISCTL', path: '~/Dev/mission-control', githubRepo: null },
  { name: 'mission-control-desktop', slug: 'mission-control-desktop', ticketPrefix: 'MCDT', path: '~/Dev/mission-control/apps/desktop', githubRepo: null },
  { name: 'omnia-vault', slug: 'omnia-vault', ticketPrefix: 'OVLT', path: '~/Dev/omnia-vault', githubRepo: null },
  { name: 'precision-imagery', slug: 'precision-imagery', ticketPrefix: 'PIMG', path: '~/Dev/precision-imagery', githubRepo: 'tylerdevries22-afk/precision-imagery' },
  { name: 'stout-music-studio', slug: 'stout-music-studio', ticketPrefix: 'SMS', path: '~/Dev/stout-music-studio', githubRepo: 'tylerdevries22-afk/Stout-Music-Studio' },
]

export const DISCOVERED_PROJECTS: FleetProjectSpec[] = [
  { name: '_ops', slug: 'ops', ticketPrefix: 'OPS', path: '~/Dev/_ops', githubRepo: null },
  { name: 'stillpoint-builders', slug: 'stillpoint-builders', ticketPrefix: 'SPB', path: '~/Dev/stillpoint-builders', githubRepo: null },
  { name: 'mayave', slug: 'mayave', ticketPrefix: 'MAYA', path: '~/Dev/mayave', githubRepo: null },
  { name: 'trustpoint-platform', slug: 'trustpoint-platform', ticketPrefix: 'TPP', path: '~/Dev/trustpoint-platform', githubRepo: null },
]

export function allSeedProjects(): FleetProjectSpec[] {
  return [...FLEET_PROJECTS, ...DISCOVERED_PROJECTS]
}

export function seedFleetProjects(
  db: SqliteDatabase,
  workspaceId: number,
): { created: number; updated: number; assigned: number } {
  const now = Math.floor(Date.now() / 1000)
  const existing = db.prepare(
    'SELECT id, slug, github_repo FROM projects WHERE workspace_id = ?',
  ).all(workspaceId) as Array<{ id: number; slug: string; github_repo: string | null }>
  const bySlug = new Map(existing.map((row) => [row.slug, row]))
  const insert = db.prepare(`
    INSERT INTO projects (workspace_id, name, slug, description, ticket_prefix, github_repo, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `)
  const updateRepo = db.prepare(
    'UPDATE projects SET github_repo = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
  )
  const assign = db.prepare(`
    INSERT OR IGNORE INTO project_agent_assignments (project_id, agent_name, role)
    VALUES (?, ?, 'member')
  `)

  let created = 0
  let updated = 0
  let assigned = 0
  const tx = db.transaction(() => {
    // Relocate only the generated checkout description; preserve custom text,
    // project IDs, task ownership, and crew assignments from the standalone repo.
    updated += db.prepare(`
      UPDATE projects SET description = ?, updated_at = ?
      WHERE workspace_id = ? AND slug = ? AND description = ?
    `).run(
      '~/Dev/mission-control/apps/desktop', now, workspaceId,
      'mission-control-desktop', '~/Dev/mission-control-desktop',
    ).changes
    for (const spec of allSeedProjects()) {
      let projectId = bySlug.get(spec.slug)?.id
      if (!projectId) {
        const result = insert.run(
          workspaceId,
          spec.name,
          spec.slug,
          spec.path,
          spec.ticketPrefix,
          spec.githubRepo,
          now,
          now,
        )
        projectId = Number(result.lastInsertRowid)
        created += 1
      } else if (!bySlug.get(spec.slug)?.github_repo && spec.githubRepo) {
        updateRepo.run(spec.githubRepo, now, projectId, workspaceId)
        updated += 1
      }
      for (const name of FLEET_AGENT_NAMES) {
        const result = assign.run(projectId, name)
        assigned += result.changes
      }
    }
    const general = db.prepare(
      'SELECT id FROM projects WHERE workspace_id = ? AND slug = ?',
    ).get(workspaceId, 'general') as { id: number } | undefined
    if (general) {
      for (const name of FLEET_AGENT_NAMES) {
        assigned += assign.run(general.id, name).changes
      }
    }
  })
  tx()
  return { created, updated, assigned }
}
