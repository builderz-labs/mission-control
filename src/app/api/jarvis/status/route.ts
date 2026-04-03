import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/api-guard'
import { isJarvisEnabled, getJarvisBaseUrl } from '@/lib/jarvis/config'
import { getDatabase } from '@/lib/db'
import * as fs from 'fs'
import * as path from 'path'

/**
 * GET /api/jarvis/status — Runtime check for JARVIS availability.
 *
 * Returns { enabled, hasToken, backendOnline } so the frontend can decide
 * whether to show the orb and attempt connection WITHOUT relying on
 * NEXT_PUBLIC_* env vars (which are baked at build time).
 *
 * Token resolution mirrors /api/jarvis/token — env var → settings DB → file.
 */
function resolveEnabled(): boolean {
  if (isJarvisEnabled()) return true
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('jarvis.enabled') as { value: string } | undefined
    return row?.value === 'true'
  } catch {
    return false
  }
}

function resolveHasToken(): boolean {
  // 1. Env var
  if (process.env.JARVIS_AUTH_TOKEN?.trim()) return true

  // 2. Settings DB
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('jarvis.auth_token') as { value: string } | undefined
    if (row?.value?.trim()) return true
  } catch { /* fall through */ }

  // 3. src/jarvis/.env file
  try {
    const jarvisEnvPath = path.join(process.cwd(), 'src', 'jarvis', '.env')
    if (!fs.existsSync(jarvisEnvPath)) return false
    const contents = fs.readFileSync(jarvisEnvPath, 'utf-8')
    return /^JARVIS_AUTH_TOKEN=.+/m.test(contents)
  } catch {
    return false
  }
}

export const GET = apiGuard({ role: 'viewer', rateLimit: 'read' }, async () => {
  const hasToken = resolveHasToken()
  // JARVIS is considered enabled if explicitly enabled OR if a token exists
  // (having a token means someone set it up — implicit enable)
  const enabled = resolveEnabled() || hasToken

  // Quick health check if enabled + has token
  let backendOnline = false
  if (hasToken) {
    try {
      const res = await fetch(`${getJarvisBaseUrl()}/api/health`, {
        signal: AbortSignal.timeout(3000),
      })
      backendOnline = res.ok
    } catch {
      backendOnline = false
    }
  }

  return NextResponse.json({ enabled, hasToken, backendOnline })
})
