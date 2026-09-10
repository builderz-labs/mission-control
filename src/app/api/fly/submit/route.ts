import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { createKeyedRateLimiter } from '@/lib/rate-limit'
import { flySubmissionSchema } from '@/lib/fly-admission-schema'
import { submitFlyLeaf } from '@/lib/fly-admission'
import { logger } from '@/lib/logger'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'

export const dynamic = 'force-dynamic'
// Durable admission is inexpensive; Machine creation has its own paced cap.
const admitLimiter = createKeyedRateLimiter({ windowMs: 60000, maxRequests: 600, critical: true })

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const denied = denyUnscopedResourceForStrictWorkspace(auth.user,'runtime_tasks','/api/fly/submit')
  if (denied) return denied
  const limited = admitLimiter(`fly:${auth.user.workspace_id}`)
  if (limited) { limited.headers.set('Retry-After','60'); return limited }
  try {
    const reader = request.body?.getReader()
    let text = ''
    let bytes = 0
    if (reader) {
      const decoder = new TextDecoder()
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) { text += decoder.decode(); break }
        bytes += chunk.value.byteLength
        if (bytes > 20000) { await reader.cancel(); return NextResponse.json({ error: 'Payload too large' }, { status: 413 }) }
        text += decoder.decode(chunk.value, { stream: true })
      }
    }
    const parsed = flySubmissionSchema.safeParse(JSON.parse(text))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid Fly submission', issues: parsed.error.issues }, { status: 400 })
    const result = submitFlyLeaf(getDatabase(), parsed.data, auth.user.workspace_id, auth.user.username)
    return NextResponse.json(result, { status: result.route === 'rejected' ? 409 : result.accepted ? 202 : 200 })
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    logger.error({ error }, 'Fly admission unavailable')
    return NextResponse.json({ error: 'Admission outcome is unknown. Retry the same request ID; do not also run locally.' }, { status: 503 })
  }
}

