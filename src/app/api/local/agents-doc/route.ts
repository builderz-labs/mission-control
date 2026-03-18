import { NextRequest, NextResponse } from 'next/server'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { requireRole } from '@/lib/auth'

async function findFirstReadable(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    try {
      await access(p, constants.R_OK)
      return p
    } catch {
      // Try next candidate
    }
  }
  return null
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const cwd = process.cwd()
  const home = homedir()
  const safeHome = home && home !== '/nonexistent' ? home : ''
  const candidates: string[] = [
    join(cwd, 'AGENTS.md'),
    join(cwd, 'agents.md'),
  ]
  if (safeHome) {
    candidates.push(
      join(safeHome, '.codex', 'AGENTS.md'),
      join(safeHome, '.agents', 'AGENTS.md'),
      join(safeHome, '.config', 'codex', 'AGENTS.md'),
    )
  }

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
