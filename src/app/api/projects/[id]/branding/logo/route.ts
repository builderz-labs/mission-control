import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import {
  CloudinaryNotConfiguredError,
  pngHasAlpha,
  projectBrandingFolder,
  resourceTypeFor,
  uploadBuffer,
} from '@/lib/cloudinary'
import { findProjectInScope, parseProjectId } from '@/lib/creative-cms'

/**
 * POST /api/projects/[id]/branding/logo
 *
 * Multipart body with a `file` field. Validates the bytes are a PNG with an
 * alpha channel (color type 4 or 6), uploads the file to Cloudinary under
 * `projects/{slug}/branding/`, records an asset row, and links it into the
 * branding profile via logo_asset_id. Creates the branding profile if missing.
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
      route: '/api/projects/[id]/branding/logo',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = parseProjectId(id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

    const project = findProjectInScope(db, projectId, workspaceId, tenantId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      return NextResponse.json({ error: 'Request must be multipart/form-data' }, { status: 415 })
    }

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json({ error: 'Failed to parse multipart body' }, { status: 400 })
    }
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const { isPng, hasAlpha } = pngHasAlpha(buffer)
    if (!isPng) return NextResponse.json({ error: 'Logo must be a PNG file' }, { status: 400 })
    if (!hasAlpha) {
      return NextResponse.json(
        {
          error:
            'Logo PNG must include an alpha channel (color type 4 or 6); export with transparency preserved',
        },
        { status: 400 }
      )
    }

    const folder = projectBrandingFolder(project.slug)
    const uploaded = await uploadBuffer(buffer, {
      folder,
      resourceType: resourceTypeFor('image'),
      tags: ['branding', 'logo', project.slug],
      context: {
        project_id: String(project.id),
        project_slug: project.slug,
        asset_type: 'image',
        asset_category: 'logo',
        uploaded_by: auth.user.username,
        source: 'mission-control',
      },
    })

    const insertAsset = db.prepare(
      `INSERT INTO project_assets
         (project_id, workspace_id, cloudinary_public_id, cloudinary_url, asset_type,
          asset_category, original_filename, tags, metadata, uploaded_by)
       VALUES (?, ?, ?, ?, 'image', 'logo', ?, ?, ?, ?)`
    )
    const assetResult = insertAsset.run(
      project.id,
      workspaceId,
      uploaded.publicId,
      uploaded.secureUrl,
      file.name || null,
      JSON.stringify(['branding', 'logo']),
      JSON.stringify({ bytes: uploaded.bytes, format: uploaded.format }),
      auth.user.username
    )
    const assetId = Number(assetResult.lastInsertRowid)

    // Upsert branding profile and link the logo.
    const existingBranding = db
      .prepare(`SELECT id FROM project_branding WHERE project_id = ?`)
      .get(project.id) as { id: number } | undefined

    if (existingBranding) {
      db.prepare(
        `UPDATE project_branding SET logo_asset_id = ?, updated_at = unixepoch() WHERE id = ?`
      ).run(assetId, existingBranding.id)
    } else {
      db.prepare(
        `INSERT INTO project_branding (project_id, workspace_id, logo_asset_id) VALUES (?, ?, ?)`
      ).run(project.id, workspaceId, assetId)
    }

    return NextResponse.json(
      {
        asset: {
          id: assetId,
          project_id: project.id,
          cloudinary_public_id: uploaded.publicId,
          cloudinary_url: uploaded.secureUrl,
          asset_type: 'image',
          asset_category: 'logo',
          original_filename: file.name || null,
        },
        branding: {
          project_id: project.id,
          logo_asset_id: assetId,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof CloudinaryNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/branding/logo error')
    return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 })
  }
}
