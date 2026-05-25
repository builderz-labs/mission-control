import { NextRequest, NextResponse } from 'next/server'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { requireRole } from '@/lib/auth'

async function findFirstReadable(paths: string[]): Promise<string | null> {
  const results = await Promise.all(
    paths.map(p => access(p, constants.R_OK).then(() => p).catch(() => null))
  )
  return results.find(p => p !== null) ?? null
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const cwd = process.cwd()
  const home = homedir()
  const candidates = [
    join(cwd, 'AGENTS.md'),
    join(cwd, 'agents.md'),
    join(home, '.codex', 'AGENTS.md'),
    join(home, '.agents', 'AGENTS.md'),
    join(home, '.config', 'codex', 'AGENTS.md'),
  ]

  const found = await findFirstReadable(candidates)
  if (!found) {
    return NextResponse.json({
      found: false,
      path: null,
      content: null,
      candidates,
    })
  }

  const content = await readFile(found, 'utf8')
  return NextResponse.json({
    found: true,
    path: found,
    content,
    candidates,
  })
}

export const dynamic = 'force-dynamic'
