import { NextRequest, NextResponse } from 'next/server'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { requireRole } from '@/lib/auth'
import { runCommand } from '@/lib/command'

function isAllowedDirectory(input: string): boolean {
  const cwd = resolve(input)
  if (!cwd.startsWith('/')) return false
  if (!(cwd.startsWith('/Users/') || cwd.startsWith('/home/') || cwd.startsWith('/tmp/') || cwd.startsWith('/var/folders/'))) {
    return false
  }
  if (!existsSync(cwd)) return false
  try {
    return statSync(cwd).isDirectory()
  } catch {
    return false
  }
}

/**
 * POST /api/local/terminal
 * Body: { cwd: string }
 * Opens a new local Terminal window at the given working directory.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const cwd = typeof body?.cwd === 'string' ? body.cwd.trim() : ''
  if (!cwd) {
    return NextResponse.json({ error: 'cwd is required' }, { status: 400 })
  }
  if (!isAllowedDirectory(cwd)) {
    return NextResponse.json({ error: 'cwd must be an existing safe local directory' }, { status: 400 })
  }

  try {
    await runCommand('open', ['-a', 'Terminal', cwd], { timeoutMs: 10_000 })
    return NextResponse.json({ ok: true, message: `Opened Terminal at ${cwd}` })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to open Terminal' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
