import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const ICON_DIR = join(homedir(), '.mission-control', 'icons')

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
}

/**
 * GET /api/agents/[id]/icon/file — Serve the uploaded icon image
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params

  for (const [ext, mime] of Object.entries(MIME_MAP)) {
    const filePath = join(ICON_DIR, `agent-${id}${ext}`)
    if (existsSync(filePath)) {
      const data = readFileSync(filePath)
      return new NextResponse(data, {
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }
  }

  return NextResponse.json({ error: 'Icon not found' }, { status: 404 })
}
