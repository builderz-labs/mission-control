import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { parseFolderOrder } from '@/lib/chat-folder-order'
import { FOLDER_ORDER_KEY, loadSettingValue, saveSettingValue } from '@/lib/chat-settings-kv'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'

const MAX_KEYS = 500

function readOrder(): string[] {
  return parseFolderOrder(loadSettingValue(FOLDER_ORDER_KEY)).slice(0, MAX_KEYS)
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDenied = denyUnscopedResourceForStrictWorkspace(auth.user, 'chat_layout', new URL(request.url).pathname)
  if (isolationDenied) return isolationDenied

  try {
    return NextResponse.json({ order: readOrder() })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/chat/folder-order error')
    return NextResponse.json({ error: 'Failed to load folder order' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDenied = denyUnscopedResourceForStrictWorkspace(auth.user, 'chat_layout', new URL(request.url).pathname)
  if (isolationDenied) return isolationDenied
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json().catch(() => ({})) as { order?: unknown }
    const order = parseFolderOrder(JSON.stringify(body.order ?? null))
    if (!Array.isArray(body.order)) {
      return NextResponse.json({ error: 'order must be a string array' }, { status: 400 })
    }
    if (body.order.length > MAX_KEYS) {
      return NextResponse.json({ error: `order must have <= ${MAX_KEYS} keys` }, { status: 400 })
    }
    saveSettingValue(
      FOLDER_ORDER_KEY,
      JSON.stringify(order),
      'Shared chat project folder order',
      auth.user.username,
    )
    return NextResponse.json({ ok: true, order })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/chat/folder-order error')
    return NextResponse.json({ error: 'Failed to save folder order' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
