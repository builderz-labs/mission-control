import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'
import { isInsideDir } from '@/lib/safe-home-path'
import { readKindTranscript } from '@/lib/session-transcript-read'
import { latestArtifact } from '@/lib/session-artifacts'
import { SESSION_ID_RE } from '@/lib/jsonl-tail'

const MAX_HTML = 400_000

function allowedFile(filePath: string): boolean {
  return isInsideDir(filePath, os.homedir())
    || isInsideDir(filePath, '/tmp')
    || isInsideDir(filePath, '/private/tmp')
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const denied = denyUnscopedResourceForStrictWorkspace(auth.user, 'session_transcripts', new URL(request.url).pathname)
  if (denied) return denied
  const { searchParams } = new URL(request.url)
  const kind = searchParams.get('kind') || ''
  const id = searchParams.get('id') || ''
  if (!SESSION_ID_RE.test(id)) return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  const artifact = latestArtifact(readKindTranscript(kind, id, 80))
  if (!artifact) return NextResponse.json({ artifact: null, html: null })
  let html: string | null = null
  if (artifact.path && allowedFile(artifact.path) && existsSync(artifact.path)) {
    try {
      const raw = readFileSync(artifact.path, 'utf8')
      if (raw.length <= MAX_HTML) html = raw
    } catch { /* no preview */ }
  }
  return NextResponse.json({ artifact, html })
}

export const dynamic = 'force-dynamic'
