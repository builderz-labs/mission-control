import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { CREATIVE_ASSET_TYPES, type CreativeAssetType } from '@/lib/cloudinary'
import {
  asStringArray,
  findProjectInScope,
  parseJsonColumn,
  parseProjectId,
  trimmedString,
} from '@/lib/creative-cms'

interface AssetRow {
  id: number
  project_id: number
  workspace_id: number
  cloudinary_public_id: string
  cloudinary_url: string
  asset_type: string
  asset_category: string | null
  original_filename: string | null
  tags: string
  metadata: string
  uploaded_by: string | null
  created_at: number
  updated_at: number
}

function serialize(row: AssetRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    workspace_id: row.workspace_id,
    cloudinary_public_id: row.cloudinary_public_id,
    cloudinary_url: row.cloudinary_url,
    asset_type: row.asset_type,
    asset_category: row.asset_category,
    original_filename: row.original_filename,
    tags: parseJsonColumn<string[]>(row.tags, []),
    metadata: parseJsonColumn<Record<string, unknown>>(row.metadata, {}),
    uploaded_by: row.uploaded_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function isAssetType(value: unknown): value is CreativeAssetType {
  return typeof value === 'string' && (CREATIVE_ASSET_TYPES as readonly string[]).includes(value)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null
    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/assets',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = parseProjectId(id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

    const project = findProjectInScope(db, projectId, workspaceId, tenantId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const url = new URL(request.url)
    const assetTypeParam = url.searchParams.get('asset_type')
    const tagParam = url.searchParams.get('tag')
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(
      200,
      Math.max(1, Number.parseInt(url.searchParams.get('pageSize') ?? '50', 10) || 50)
    )

    if (assetTypeParam && !isAssetType(assetTypeParam)) {
      return NextResponse.json({ error: `Unknown asset_type: ${assetTypeParam}` }, { status: 400 })
    }

    const whereParts = ['project_id = ?']
    const whereArgs: unknown[] = [projectId]
    if (assetTypeParam) {
      whereParts.push('asset_type = ?')
      whereArgs.push(assetTypeParam)
    }
    const where = whereParts.join(' AND ')

    const rows = db
      .prepare(`SELECT * FROM project_assets WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...whereArgs, pageSize, (page - 1) * pageSize) as AssetRow[]

    const filtered = tagParam ? rows.filter((r) => parseJsonColumn<string[]>(r.tags, []).includes(tagParam)) : rows

    const totalRow = db
      .prepare(`SELECT COUNT(*) as total FROM project_assets WHERE ${where}`)
      .get(...whereArgs) as { total: number }

    return NextResponse.json({
      assets: filtered.map(serialize),
      page,
      pageSize,
      total: totalRow.total,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/assets error')
    return NextResponse.json({ error: 'Failed to fetch assets' }, { status: 500 })
  }
}

/**
 * Record an asset that was already uploaded directly to Cloudinary
 * (e.g. via the signed-upload flow at /assets/sign).
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
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null
    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/assets',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = parseProjectId(id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

    const project = findProjectInScope(db, projectId, workspaceId, tenantId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 })

    const cloudinaryPublicId = trimmedString(body.cloudinary_public_id, 500)
    const cloudinaryUrl = trimmedString(body.cloudinary_url, 2000)
    if (!cloudinaryPublicId) return NextResponse.json({ error: 'cloudinary_public_id is required' }, { status: 400 })
    if (!cloudinaryUrl) return NextResponse.json({ error: 'cloudinary_url is required' }, { status: 400 })
    if (!isAssetType(body.asset_type)) {
      return NextResponse.json({ error: 'asset_type must be one of the known creative-CMS types' }, { status: 400 })
    }
    const assetType = body.asset_type as CreativeAssetType

    const existing = db
      .prepare(`SELECT id FROM project_assets WHERE cloudinary_public_id = ?`)
      .get(cloudinaryPublicId) as { id: number } | undefined
    if (existing) {
      return NextResponse.json(
        { error: `An asset with cloudinary_public_id "${cloudinaryPublicId}" already exists` },
        { status: 409 }
      )
    }

    const assetCategory = trimmedString(body.asset_category, 120)
    const originalFilename = trimmedString(body.original_filename, 255)
    const tags = Array.isArray(body.tags) ? asStringArray(body.tags) : []
    const metadata =
      body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : {}

    const result = db
      .prepare(
        `INSERT INTO project_assets
           (project_id, workspace_id, cloudinary_public_id, cloudinary_url, asset_type,
            asset_category, original_filename, tags, metadata, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        project.id,
        workspaceId,
        cloudinaryPublicId,
        cloudinaryUrl,
        assetType,
        assetCategory,
        originalFilename,
        JSON.stringify(tags),
        JSON.stringify(metadata),
        auth.user.username
      )

    const created = db
      .prepare(`SELECT * FROM project_assets WHERE id = ?`)
      .get(Number(result.lastInsertRowid)) as AssetRow
    return NextResponse.json({ asset: serialize(created) }, { status: 201 })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/assets error')
    return NextResponse.json({ error: 'Failed to record asset' }, { status: 500 })
  }
}
