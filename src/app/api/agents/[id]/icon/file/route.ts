import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const ICON_DIR = join(process.cwd(), '.data', 'agent-icons')

const mimeTypes: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
}

/**
 * GET /api/agents/[id]/icon/file — Serve the agent's uploaded icon image
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  for (const [ext, mime] of Object.entries(mimeTypes)) {
    const filepath = join(ICON_DIR, `agent-${id}.${ext}`)
    if (existsSync(filepath)) {
      const data = readFileSync(filepath)
      return new NextResponse(data, {
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        },
      })
    }
  }

  return NextResponse.json({ error: 'Icon not found' }, { status: 404 })
}
