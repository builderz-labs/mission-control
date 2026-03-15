import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'
import {
  initGnapRepo,
  syncGnap,
  getGnapStatus,
} from '@/lib/gnap-sync'

/**
 * GET /api/gnap — GNAP sync status
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const gnapConfig = config.gnap
  if (!gnapConfig.enabled) {
    return NextResponse.json({ enabled: false })
  }

  try {
    const status = getGnapStatus(gnapConfig.repoPath)
    return NextResponse.json({
      enabled: true,
      repoPath: gnapConfig.repoPath,
      autoSync: gnapConfig.autoSync,
      ...status,
    })
  } catch (err) {
    logger.error({ err }, 'GET /api/gnap error')
    return NextResponse.json({ error: 'Failed to get GNAP status' }, { status: 500 })
  }
}

/**
 * POST /api/gnap?action=init|sync — GNAP management
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const gnapConfig = config.gnap
  if (!gnapConfig.enabled) {
    return NextResponse.json({ error: 'GNAP is not enabled' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  try {
    switch (action) {
      case 'init': {
        initGnapRepo(gnapConfig.repoPath)
        const status = getGnapStatus(gnapConfig.repoPath)
        return NextResponse.json({ success: true, ...status })
      }
      case 'sync': {
        const result = syncGnap(gnapConfig.repoPath)
        return NextResponse.json({ success: true, ...result })
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    logger.error({ err, action }, 'POST /api/gnap error')
    return NextResponse.json({ error: 'GNAP operation failed' }, { status: 500 })
  }
}
