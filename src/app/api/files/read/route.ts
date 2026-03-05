import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { resolveWithin } from '@/lib/paths'
import { config } from '@/lib/config'

const ALLOWED_EXTENSIONS = new Set([
  '.csv', '.txt', '.json', '.md', '.log',
  '.xml', '.yaml', '.yml', '.tsv', '.html',
])

const MAX_BYTES = 50 * 1024 // 50KB
const MAX_LINES = 200

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const rawPath = (searchParams.get('path') || '').trim()

  if (!rawPath) {
    return NextResponse.json({ error: 'Path required' }, { status: 400 })
  }

  // Expand ~ to home directory
  const expandedPath = rawPath.startsWith('~')
    ? path.join(config.homeDir, rawPath.slice(1))
    : rawPath

  const extension = path.extname(expandedPath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return NextResponse.json(
      { error: `Unsupported file extension: ${extension || '(none)'}` },
      { status: 400 },
    )
  }

  // Path traversal protection: resolve within the parent directory
  let safePath: string
  try {
    const dir = path.dirname(expandedPath)
    const base = path.basename(expandedPath)
    safePath = resolveWithin(dir, base)
  } catch {
    return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
  }

  if (!fs.existsSync(safePath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const stat = fs.statSync(safePath)
  if (!stat.isFile()) {
    return NextResponse.json({ error: 'Not a file' }, { status: 400 })
  }

  const raw = fs.readFileSync(safePath, 'utf-8')
  const allLines = raw.split('\n')
  let truncated = false
  let content: string

  if (allLines.length > MAX_LINES) {
    content = allLines.slice(0, MAX_LINES).join('\n')
    truncated = true
  } else {
    content = raw
  }

  if (Buffer.byteLength(content, 'utf-8') > MAX_BYTES) {
    // Truncate to fit within byte limit
    const buf = Buffer.from(content, 'utf-8')
    content = buf.subarray(0, MAX_BYTES).toString('utf-8')
    truncated = true
  }

  const lines = content.split('\n').length

  return NextResponse.json({
    content,
    size: stat.size,
    path: safePath,
    truncated,
    lines,
    extension,
  })
}
