import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import {
  asStringArray,
  findProjectInScope,
  isHexColor,
  parseJsonColumn,
  parseProjectId,
  trimmedString,
} from '@/lib/creative-cms'

interface BrandingRow {
  id: number
  project_id: number
  workspace_id: number
  brand_name: string | null
  primary_color: string | null
  secondary_color: string | null
  accent_colors: string
  heading_font: string | null
  body_font: string | null
  approved_fonts: string
  logo_asset_id: number | null
  brand_notes: string | null
  tone_notes: string | null
  created_at: number
  updated_at: number
}

function serialize(row: BrandingRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    workspace_id: row.workspace_id,
    brand_name: row.brand_name,
    primary_color: row.primary_color,
    secondary_color: row.secondary_color,
    accent_colors: parseJsonColumn<string[]>(row.accent_colors, []),
    heading_font: row.heading_font,
    body_font: row.body_font,
    approved_fonts: parseJsonColumn<string[]>(row.approved_fonts, []),
    logo_asset_id: row.logo_asset_id,
    brand_notes: row.brand_notes,
    tone_notes: row.tone_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

interface ParsedBrandingInput {
  brand_name?: string | null
  primary_color?: string | null
  secondary_color?: string | null
  accent_colors?: string[]
  heading_font?: string | null
  body_font?: string | null
  approved_fonts?: string[]
  brand_notes?: string | null
  tone_notes?: string | null
}

function parseBrandingBody(body: unknown): { value?: ParsedBrandingInput; error?: string } {
  if (!body || typeof body !== 'object') return { error: 'Request body must be a JSON object' }
  const b = body as Record<string, unknown>
  const out: ParsedBrandingInput = {}

  if ('brand_name' in b) out.brand_name = trimmedString(b.brand_name, 200)

  for (const colorKey of ['primary_color', 'secondary_color'] as const) {
    if (colorKey in b) {
      const raw = b[colorKey]
      if (raw === null || raw === '') {
        out[colorKey] = null
      } else if (isHexColor(raw)) {
        out[colorKey] = raw
      } else {
        return { error: `${colorKey} must be a hex color (e.g. "#0B5FFF") or null` }
      }
    }
  }

  if ('accent_colors' in b) {
    if (!Array.isArray(b.accent_colors)) return { error: 'accent_colors must be an array' }
    for (const c of b.accent_colors) {
      if (!isHexColor(c)) return { error: `accent_colors contains an invalid hex color: ${String(c)}` }
    }
    out.accent_colors = b.accent_colors as string[]
  }

  if ('heading_font' in b) out.heading_font = trimmedString(b.heading_font, 120)
  if ('body_font' in b) out.body_font = trimmedString(b.body_font, 120)

  if ('approved_fonts' in b) {
    if (!Array.isArray(b.approved_fonts)) return { error: 'approved_fonts must be an array' }
    out.approved_fonts = asStringArray(b.approved_fonts).map((f) => f.slice(0, 120))
  }

  if ('brand_notes' in b) out.brand_notes = trimmedString(b.brand_notes, 5000)
  if ('tone_notes' in b) out.tone_notes = trimmedString(b.tone_notes, 5000)

  return { value: out }
}

function applyAudit(
  request: NextRequest,
  db: ReturnType<typeof getDatabase>,
  auth: Extract<ReturnType<typeof requireRole>, { user: unknown }>,
  routeLabel: string
): { workspaceId: number; tenantId: number } {
  const workspaceId = auth.user.workspace_id ?? 1
  const tenantId = auth.user.tenant_id ?? 1
  const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null
  ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
    actor: auth.user.username,
    actorId: auth.user.id,
    route: routeLabel,
    ipAddress: forwardedFor,
    userAgent: request.headers.get('user-agent'),
  })
  return { workspaceId, tenantId }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { workspaceId, tenantId } = applyAudit(request, db, auth, '/api/projects/[id]/branding')

    const { id } = await params
    const projectId = parseProjectId(id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

    const project = findProjectInScope(db, projectId, workspaceId, tenantId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const row = db
      .prepare(`SELECT * FROM project_branding WHERE project_id = ?`)
      .get(projectId) as BrandingRow | undefined
    if (!row) return NextResponse.json({ error: 'Branding profile not found' }, { status: 404 })

    return NextResponse.json({ branding: serialize(row) })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/branding error')
    return NextResponse.json({ error: 'Failed to fetch branding profile' }, { status: 500 })
  }
}

/**
 * POST upserts: creates a branding profile if none exists for the project,
 * otherwise replaces all provided fields. Returns 200 on update, 201 on create.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const { workspaceId, tenantId } = applyAudit(request, db, auth, '/api/projects/[id]/branding')

    const { id } = await params
    const projectId = parseProjectId(id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

    const project = findProjectInScope(db, projectId, workspaceId, tenantId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const body = await request.json().catch(() => null)
    const parsed = parseBrandingBody(body)
    if (parsed.error || !parsed.value) {
      return NextResponse.json({ error: parsed.error ?? 'Invalid body' }, { status: 400 })
    }
    const v = parsed.value

    const existing = db
      .prepare(`SELECT id FROM project_branding WHERE project_id = ?`)
      .get(projectId) as { id: number } | undefined

    if (existing) {
      db.prepare(
        `UPDATE project_branding
         SET brand_name = ?, primary_color = ?, secondary_color = ?, accent_colors = ?,
             heading_font = ?, body_font = ?, approved_fonts = ?,
             brand_notes = ?, tone_notes = ?, updated_at = unixepoch()
         WHERE id = ?`
      ).run(
        v.brand_name ?? null,
        v.primary_color ?? null,
        v.secondary_color ?? null,
        JSON.stringify(v.accent_colors ?? []),
        v.heading_font ?? null,
        v.body_font ?? null,
        JSON.stringify(v.approved_fonts ?? []),
        v.brand_notes ?? null,
        v.tone_notes ?? null,
        existing.id
      )
      const updated = db
        .prepare(`SELECT * FROM project_branding WHERE id = ?`)
        .get(existing.id) as BrandingRow
      return NextResponse.json({ branding: serialize(updated) })
    }

    const result = db.prepare(
      `INSERT INTO project_branding
         (project_id, workspace_id, brand_name, primary_color, secondary_color, accent_colors,
          heading_font, body_font, approved_fonts, brand_notes, tone_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      projectId,
      workspaceId,
      v.brand_name ?? null,
      v.primary_color ?? null,
      v.secondary_color ?? null,
      JSON.stringify(v.accent_colors ?? []),
      v.heading_font ?? null,
      v.body_font ?? null,
      JSON.stringify(v.approved_fonts ?? []),
      v.brand_notes ?? null,
      v.tone_notes ?? null
    )
    const created = db
      .prepare(`SELECT * FROM project_branding WHERE id = ?`)
      .get(Number(result.lastInsertRowid)) as BrandingRow
    return NextResponse.json({ branding: serialize(created) }, { status: 201 })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/branding error')
    return NextResponse.json({ error: 'Failed to save branding profile' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const { workspaceId, tenantId } = applyAudit(request, db, auth, '/api/projects/[id]/branding')

    const { id } = await params
    const projectId = parseProjectId(id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

    const project = findProjectInScope(db, projectId, workspaceId, tenantId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const existing = db
      .prepare(`SELECT * FROM project_branding WHERE project_id = ?`)
      .get(projectId) as BrandingRow | undefined
    if (!existing) return NextResponse.json({ error: 'Branding profile not found' }, { status: 404 })

    const body = await request.json().catch(() => null)
    const parsed = parseBrandingBody(body)
    if (parsed.error || !parsed.value) {
      return NextResponse.json({ error: parsed.error ?? 'Invalid body' }, { status: 400 })
    }
    const v = parsed.value

    // Build a partial update — only touch keys explicitly provided.
    const sets: string[] = []
    const args: unknown[] = []
    if ('brand_name' in v) {
      sets.push('brand_name = ?')
      args.push(v.brand_name ?? null)
    }
    if ('primary_color' in v) {
      sets.push('primary_color = ?')
      args.push(v.primary_color ?? null)
    }
    if ('secondary_color' in v) {
      sets.push('secondary_color = ?')
      args.push(v.secondary_color ?? null)
    }
    if ('accent_colors' in v) {
      sets.push('accent_colors = ?')
      args.push(JSON.stringify(v.accent_colors ?? []))
    }
    if ('heading_font' in v) {
      sets.push('heading_font = ?')
      args.push(v.heading_font ?? null)
    }
    if ('body_font' in v) {
      sets.push('body_font = ?')
      args.push(v.body_font ?? null)
    }
    if ('approved_fonts' in v) {
      sets.push('approved_fonts = ?')
      args.push(JSON.stringify(v.approved_fonts ?? []))
    }
    if ('brand_notes' in v) {
      sets.push('brand_notes = ?')
      args.push(v.brand_notes ?? null)
    }
    if ('tone_notes' in v) {
      sets.push('tone_notes = ?')
      args.push(v.tone_notes ?? null)
    }

    if (sets.length === 0) return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })

    sets.push('updated_at = unixepoch()')
    args.push(existing.id)
    db.prepare(`UPDATE project_branding SET ${sets.join(', ')} WHERE id = ?`).run(...args)

    const updated = db
      .prepare(`SELECT * FROM project_branding WHERE id = ?`)
      .get(existing.id) as BrandingRow
    return NextResponse.json({ branding: serialize(updated) })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'PATCH /api/projects/[id]/branding error')
    return NextResponse.json({ error: 'Failed to update branding profile' }, { status: 500 })
  }
}
