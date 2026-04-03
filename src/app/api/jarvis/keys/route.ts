import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/api-guard'
import { getJarvisBaseUrl } from '@/lib/jarvis/config'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Resolve the Jarvis auth token for backend API calls.
 * Mirrors the resolution in /api/jarvis/token.
 */
function resolveJarvisToken(): string | null {
  const envToken = process.env.JARVIS_AUTH_TOKEN?.trim()
  if (envToken) return envToken

  try {
    const { getDatabase } = require('@/lib/db')
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('jarvis.auth_token') as { value: string } | undefined
    if (row?.value?.trim()) return row.value.trim()
  } catch { /* fall through */ }

  try {
    const jarvisEnvPath = path.join(process.cwd(), 'src', 'jarvis', '.env')
    if (!fs.existsSync(jarvisEnvPath)) return null
    const contents = fs.readFileSync(jarvisEnvPath, 'utf-8')
    for (const line of contents.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      if (key === 'JARVIS_AUTH_TOKEN') {
        return trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
      }
    }
  } catch { /* fall through */ }

  return null
}

/**
 * GET /api/jarvis/keys — Get the status of API keys configured on the Jarvis backend.
 * Returns masked key status (never the actual keys).
 */
export const GET = apiGuard({ role: 'admin', rateLimit: 'read' }, async () => {
  const token = resolveJarvisToken()
  if (!token) {
    return NextResponse.json({ error: 'Jarvis auth token not found' }, { status: 503 })
  }

  try {
    const res = await fetch(`${getJarvisBaseUrl()}/api/settings/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to reach Jarvis backend' }, { status: 502 })
    }
    const data = await res.json()
    return NextResponse.json({
      anthropic: data.env_keys_set?.anthropic ?? false,
      fish_audio: data.env_keys_set?.fish_audio ?? false,
      fish_voice_id: data.env_keys_set?.fish_voice_id ?? false,
      user_name: data.env_keys_set?.user_name ?? '',
    })
  } catch {
    return NextResponse.json({ error: 'Jarvis backend unreachable' }, { status: 503 })
  }
})

/**
 * POST /api/jarvis/keys — Save an API key to the Jarvis backend .env file.
 * The key is sent to the Jarvis backend which writes it to its .env file.
 * Keys are NEVER stored in the Next.js frontend or database.
 */
export const POST = apiGuard({ role: 'admin', rateLimit: 'mutation' }, async (request: Request) => {
  const token = resolveJarvisToken()
  if (!token) {
    return NextResponse.json({ error: 'Jarvis auth token not found' }, { status: 503 })
  }

  const body = await request.json().catch(() => ({}))
  const { key_name, key_value } = body as { key_name?: string; key_value?: string }

  if (!key_name || typeof key_value !== 'string') {
    return NextResponse.json({ error: 'Missing key_name or key_value' }, { status: 400 })
  }

  // Only allow known safe keys
  const allowed = new Set(['ANTHROPIC_API_KEY', 'FISH_API_KEY', 'FISH_VOICE_ID', 'USER_NAME', 'TTS_ENGINE'])
  if (!allowed.has(key_name)) {
    return NextResponse.json({ error: 'Invalid key name' }, { status: 400 })
  }

  try {
    const res = await fetch(`${getJarvisBaseUrl()}/api/settings/keys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key_name, key_value }),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json()
    if (!res.ok || !data.success) {
      return NextResponse.json({ error: data.error || 'Failed to save key' }, { status: res.status })
    }
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Jarvis backend unreachable' }, { status: 503 })
  }
})

/**
 * PUT /api/jarvis/keys — Test an API key against the Jarvis backend.
 * Returns { valid: boolean, error?: string }
 */
export const PUT = apiGuard({ role: 'admin', rateLimit: 'mutation' }, async (request: Request) => {
  const token = resolveJarvisToken()
  if (!token) {
    return NextResponse.json({ error: 'Jarvis auth token not found' }, { status: 503 })
  }

  const body = await request.json().catch(() => ({}))
  const { provider, key_value } = body as { provider?: string; key_value?: string }

  if (!provider) {
    return NextResponse.json({ error: 'Missing provider' }, { status: 400 })
  }

  const endpoint = provider === 'anthropic' ? 'test-anthropic' : provider === 'fish' ? 'test-fish' : null
  if (!endpoint) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }

  try {
    const res = await fetch(`${getJarvisBaseUrl()}/api/settings/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key_value: key_value || null }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ valid: false, error: 'Jarvis backend unreachable' })
  }
})
