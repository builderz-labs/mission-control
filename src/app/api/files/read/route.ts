import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'

const ALLOWED_EXTENSIONS = new Set([
  '.csv', '.txt', '.json', '.md', '.log',
  '.xml', '.yaml', '.yml', '.tsv', '.html',
])

const MAX_BYTES = 50 * 1024 // 50KB
const MAX_LINES = 200

/**
 * Allowed root directories for file reads.
 * Only files within these directories (after realpath resolution) can be read.
 */
function getAllowedRoots(): string[] {
  const roots: string[] = []

  // User home directory (agents save files here by default)
  if (config.homeDir) roots.push(config.homeDir)

  // OpenClaw workspace directory
  if (config.openclawStateDir) roots.push(config.openclawStateDir)

  // Memory / knowledge-base directory
  if (config.memoryDir) roots.push(config.memoryDir)

  // Additional roots via env var (comma-separated)
  const extra = (process.env.MC_FILE_READ_ROOTS || '').trim()
  if (extra) {
    for (const r of extra.split(',')) {
      const trimmed = r.trim()
      if (trimmed) roots.push(trimmed)
    }
  }

  return roots
}

/**
 * Check if a resolved real path falls within any allowed root.
 * Uses realpath to resolve symlinks before comparison.
 */
function isWithinAllowedRoot(filePath: string): boolean {
  let realFilePath: string
  try {
    realFilePath = fs.realpathSync(filePath)
  } catch {
    return false
  }

  for (const root of getAllowedRoots()) {
    let realRoot: string
    try {
      realRoot = fs.realpathSync(root)
    } catch {
      continue
    }
    if (realFilePath === realRoot || realFilePath.startsWith(realRoot + path.sep)) {
      return true
    }
  }
  return false
}

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

  // Resolve to absolute path
  const resolved = path.resolve(expandedPath)

  const extension = path.extname(resolved).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return NextResponse.json(
      { error: `Unsupported file extension: ${extension || '(none)'}` },
      { status: 400 },
    )
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const stat = fs.statSync(resolved)
  if (!stat.isFile()) {
    return NextResponse.json({ error: 'Not a file' }, { status: 400 })
  }

  // Enforce trusted-root boundary after resolving symlinks
  if (!isWithinAllowedRoot(resolved)) {
    return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
  }

  const raw = fs.readFileSync(resolved, 'utf-8')
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
    const buf = Buffer.from(content, 'utf-8')
    content = buf.subarray(0, MAX_BYTES).toString('utf-8')
    truncated = true
  }

  const lines = content.split('\n').length

  return NextResponse.json({
    content,
    size: stat.size,
    path: resolved,
    truncated,
    lines,
    extension,
  })
}
