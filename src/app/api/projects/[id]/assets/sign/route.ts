import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import {
  CREATIVE_ASSET_TYPES,
  CloudinaryNotConfiguredError,
  type CreativeAssetType,
  projectAssetFolder,
  resourceTypeFor,
  signUpload,
} from '@/lib/cloudinary'
import { asStringArray, findProjectInScope, parseProjectId, trimmedString } from '@/lib/creative-cms'

function isAssetType(value: unknown): value is CreativeAssetType {
  return typeof value === 'string' && (CREATIVE_ASSET_TYPES as readonly string[]).includes(value)
}

/**
 * POST /api/projects/[id]/assets/sign
 *
 * Returns a signed-upload payload the frontend uses to POST a file directly
 * to Cloudinary. The bytes never touch this server. After Cloudinary returns
 * a `public_id` + `secure_url`, the frontend records the asset by calling
 * POST /api/projects/[id]/assets.
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
      route: '/api/projects/[id]/assets/sign',
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
    if (!isAssetType(body.asset_type)) {
      return NextResponse.json({ error: 'asset_type must be one of the known creative-CMS types' }, { status: 400 })
    }
    const assetType = body.asset_type as CreativeAssetType
    const assetCategory = trimmedString(body.asset_category, 120)
    const extraTags = Array.isArray(body.tags) ? asStringArray(body.tags) : []

    const folder = projectAssetFolder(project.slug, assetType)
    const publicId = randomBytes(12).toString('hex')

    const tags = ['mission-control', project.slug, assetType, ...extraTags]
    const context: Record<string, string> = {
      project_id: String(project.id),
      project_slug: project.slug,
      asset_type: assetType,
      asset_category: assetCategory ?? '',
      uploaded_by: auth.user.username,
      source: 'mission-control',
    }

    const signed = signUpload({
      folder,
      publicId,
      resourceType: resourceTypeFor(assetType),
      tags,
      context,
    })

    return NextResponse.json({
      cloud_name: signed.cloudName,
      api_key: signed.apiKey,
      resource_type: signed.resourceType,
      upload_url: signed.uploadUrl,
      signature: signed.signature,
      timestamp: signed.timestamp,
      folder: signed.folder,
      public_id: signed.publicId,
      tags: signed.tags,
      context: signed.context,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof CloudinaryNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/assets/sign error')
    return NextResponse.json({ error: 'Failed to sign upload' }, { status: 500 })
  }
}
