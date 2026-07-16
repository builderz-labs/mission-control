import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requireRole, hashApiKey } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { identitySecurityMutationLimiter } from '@/lib/rate-limit'

interface ApiKeyHashRow {
  updated_by: string | null
  updated_at: number
}

/**
 * Mask an API key for display: show first 4 and last 5 chars.
 * e.g. "mc_a1b2c3d4e5f6g7h8i9j0" -> "mc_a****j0"
 * Only possible for env keys — DB keys are stored as sha256 hashes and
 * cannot be displayed after creation.
 */
function maskApiKey(key: string): string {
  if (key.length <= 9) return '****'
  return key.slice(0, 4) + '-****-****-' + key.slice(-5)
}

/**
 * GET /api/tokens/rotate - Get metadata about the current API key
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()

  // Check for DB-stored override first. Only the sha256 hash is stored,
  // so the key itself cannot be shown (not even masked) after creation.
  const row = db.prepare(
    "SELECT updated_by, updated_at FROM settings WHERE key = 'security.api_key_hash'"
  ).get() as ApiKeyHashRow | undefined

  if (row) {
    return NextResponse.json({
      masked_key: null,
      configured: true,
      source: 'database',
      last_rotated_at: row.updated_at,
      last_rotated_by: row.updated_by,
    })
  }

  // Fall back to env var
  const envKey = (process.env.API_KEY || '').trim()
  if (envKey) {
    return NextResponse.json({
      masked_key: maskApiKey(envKey),
      configured: true,
      source: 'environment',
      last_rotated_at: null,
      last_rotated_by: null,
    })
  }

  return NextResponse.json({
    masked_key: null,
    configured: false,
    source: 'none',
    last_rotated_at: null,
    last_rotated_by: null,
  })
}

/**
 * POST /api/tokens/rotate - Generate and store a new API key
 *
 * Only sha256(key) is persisted (settings 'security.api_key_hash');
 * the plaintext key is returned exactly once in this response.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = identitySecurityMutationLimiter(`${auth.user.tenant_id ?? 1}:${auth.user.workspace_id ?? 1}:${auth.user.id}:api-key`)
  if (rateCheck) return rateCheck

  // Generate a new key: mc_ prefix + 48 random hex chars
  const newKey = 'mc_' + randomBytes(24).toString('hex')

  const db = getDatabase()

  // Get old key info for audit trail
  const existingHash = db.prepare(
    "SELECT key FROM settings WHERE key = 'security.api_key_hash'"
  ).get() as { key: string } | undefined
  const existingLegacy = db.prepare(
    "SELECT value FROM settings WHERE key = 'security.api_key'"
  ).get() as { value: string } | undefined

  const oldSource = existingHash || existingLegacy
    ? 'database'
    : (process.env.API_KEY || '').trim() ? 'environment' : 'none'
  // Hashed keys cannot be masked — only legacy plaintext or env keys can.
  const oldMasked = existingLegacy
    ? maskApiKey(existingLegacy.value)
    : !existingHash && (process.env.API_KEY || '').trim()
      ? maskApiKey((process.env.API_KEY || '').trim())
      : null

  // Store only the hash in settings (overrides env var); remove any legacy
  // plaintext row so the raw key never remains at rest.
  const writeTxn = db.transaction(() => {
    db.prepare(`
      INSERT INTO settings (key, value, description, category, updated_by, updated_at)
      VALUES ('security.api_key_hash', ?, 'SHA-256 hash of the active API key (overrides API_KEY env var)', 'security', ?, unixepoch())
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_by = excluded.updated_by,
        updated_at = unixepoch()
    `).run(hashApiKey(newKey), auth.user.username)
    db.prepare("DELETE FROM settings WHERE key = 'security.api_key'").run()
  })
  writeTxn()

  // Audit log
  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'api_key_rotated',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: {
      old_source: oldSource,
      old_key_masked: oldMasked,
      new_key_masked: maskApiKey(newKey),
    },
    ip_address: ipAddress,
  })

  return NextResponse.json({
    key: newKey,
    masked_key: maskApiKey(newKey),
    rotated_at: Math.floor(Date.now() / 1000),
    rotated_by: auth.user.username,
    message: 'API key rotated successfully. Copy the key now — it will not be shown again.',
  })
}
