import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { liveUsageTracker } from '@/lib/chat-usage-live'
import { detectProviderSubscriptions } from '@/lib/provider-subscriptions'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDenied = denyUnscopedResourceForStrictWorkspace(auth.user, 'chat_layout', new URL(request.url).pathname)
  if (isolationDenied) return isolationDenied

  try {
    const url = new URL(request.url)
    const kind = url.searchParams.get('kind') || 'claude-code'
    const tokens = url.searchParams.get('tokens') || ''
    const model = url.searchParams.get('model') || ''
    const detected = detectProviderSubscriptions()
    const provider = kind === 'codex-cli' ? 'openai' : kind === 'grok' ? 'xai' : kind === 'kimi' ? 'moonshot' : 'anthropic'
    const plan = detected.active[provider]?.type
    const tracker = liveUsageTracker({
      kind,
      tokens,
      model,
      plan,
      workspaceId: auth.user.workspace_id ?? 1,
    })
    return NextResponse.json({ tracker })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/chat/usage error')
    return NextResponse.json({ error: 'Failed to load usage' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
