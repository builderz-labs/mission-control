import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { buildGatewayWebSocketUrl } from '@/lib/gateway-url'
import { getDetectedGatewayToken } from '@/lib/gateway-runtime'

interface GatewayEntry {
  id: number
  host: string
  port: number
  token: string
  is_primary: number
}

function ensureTable(db: ReturnType<typeof getDatabase>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gateways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL DEFAULT '127.0.0.1',
      port INTEGER NOT NULL DEFAULT 18789,
      token TEXT NOT NULL DEFAULT '',
      is_primary INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_seen INTEGER,
      latency INTEGER,
      sessions_count INTEGER NOT NULL DEFAULT 0,
      agents_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)
}

/**
 * POST /api/gateways/connect
 * Resolves websocket URL and token for a selected gateway without exposing tokens in list payloads.
 */
export async function POST(request: NextRequest) {
  // Any authenticated dashboard user may initiate a gateway websocket connect.
  // Restricting this to operator can cause startup fallback to connect without auth,
  // which then fails as "device identity required".
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  ensureTable(db)

  let id: number | null = null
  try {
    const body = await request.json()
    id = Number(body?.id)
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!id || !Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const gateway = db.prepare('SELECT id, host, port, token, is_primary FROM gateways WHERE id = ?').get(id) as GatewayEntry | undefined
  if (!gateway) {
    return NextResponse.json({ error: 'Gateway not found' }, { status: 404 })
  }

  const ws_url = buildGatewayWebSocketUrl({
    host: gateway.host,
    port: gateway.port,
    browserProtocol: request.nextUrl.protocol,
  })

  const dbToken = (gateway.token || '').trim()
  const detectedToken = gateway.is_primary === 1 ? getDetectedGatewayToken() : ''
  const token = detectedToken || dbToken

  // Keep runtime DB aligned with detected OpenClaw gateway token for primary gateway.
  if (gateway.is_primary === 1 && detectedToken && detectedToken !== dbToken) {
    try {
      db.prepare('UPDATE gateways SET token = ?, updated_at = (unixepoch()) WHERE id = ?').run(detectedToken, gateway.id)
    } catch {
      // Non-fatal: connect still succeeds with detected token even if persistence fails.
    }
  }

  return NextResponse.json({
    id: gateway.id,
    ws_url,
    token,
    token_set: token.length > 0,
  })
}
