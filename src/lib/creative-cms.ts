import type Database from 'better-sqlite3'

/**
 * Shared helpers for the creative-CMS route handlers
 * (branding, assets, context). Keeps the SQL for project scope checks in
 * one place and centralises JSON column (de)serialisation, matching the
 * conventions used by the existing /api/projects/[id]/* routes.
 */

export function parseProjectId(raw: string): number {
  const id = Number.parseInt(raw, 10)
  return Number.isFinite(id) && id > 0 ? id : NaN
}

export interface ProjectScopeRow {
  id: number
  slug: string
  name: string
}

/**
 * Returns the project iff it exists AND belongs to the given workspace AND
 * the workspace belongs to the given tenant. Returns null otherwise.
 *
 * The two-step check (`projects.workspace_id = ?` + `workspaces.tenant_id = ?`)
 * mirrors the inline check used in `src/app/api/projects/[id]/agents/route.ts`.
 */
export function findProjectInScope(
  db: Database.Database,
  projectId: number,
  workspaceId: number,
  tenantId: number
): ProjectScopeRow | null {
  const row = db
    .prepare(
      `SELECT p.id, p.slug, p.name
       FROM projects p
       JOIN workspaces w ON w.id = p.workspace_id
       WHERE p.id = ? AND p.workspace_id = ? AND w.tenant_id = ?
       LIMIT 1`
    )
    .get(projectId, workspaceId, tenantId) as ProjectScopeRow | undefined
  return row ?? null
}

/**
 * `JSON.parse` with a fallback, for columns we store as JSON text.
 * Returns the fallback when input is null/empty or malformed.
 */
export function parseJsonColumn<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string').map((s) => s.slice(0, 200))
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value)
}

export function trimmedString(value: unknown, max = 5000): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (t.length === 0) return null
  return t.slice(0, max)
}
