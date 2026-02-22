import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { config } from '@/lib/config'
import { join } from 'path'

function getConfigPath(): string | null {
  if (!config.openclawHome) return null
  return join(config.openclawHome, 'openclaw.json')
}

/**
 * GET /api/gateway-config - Read the gateway configuration
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const configPath = getConfigPath()
  if (!configPath) {
    return NextResponse.json({ error: 'OPENCLAW_HOME not configured' }, { status: 404 })
  }

  try {
    const { readFile } = require('fs/promises')
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw)

    // Redact sensitive fields for display
    const redacted = redactSensitive(JSON.parse(JSON.stringify(parsed)))

    return NextResponse.json({
      path: configPath,
      config: redacted,
      raw_size: raw.length,
    })
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return NextResponse.json({ error: 'Config file not found', path: configPath }, { status: 404 })
    }
    return NextResponse.json({ error: `Failed to read config: ${err.message}` }, { status: 500 })
  }
}

/**
 * PUT /api/gateway-config - Update specific config fields
 * Body: { updates: { "path.to.key": value, ... } }
 *
 * Uses dot-notation paths to set nested values.
 * CRITICAL: Preserves gateway.auth.password and other sensitive fields.
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const configPath = getConfigPath()
  if (!configPath) {
    return NextResponse.json({ error: 'OPENCLAW_HOME not configured' }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  if (!body?.updates || typeof body.updates !== 'object') {
    return NextResponse.json({ error: 'updates object required (dot-notation paths)' }, { status: 400 })
  }

  // Block writes to sensitive paths
  const blockedPaths = ['gateway.auth.password', 'gateway.auth.secret']
  for (const key of Object.keys(body.updates)) {
    if (blockedPaths.some(bp => key.startsWith(bp))) {
      return NextResponse.json({ error: `Cannot modify protected field: ${key}` }, { status: 403 })
    }
  }

  try {
    const { readFile, writeFile } = require('fs/promises')
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw)

    // Apply updates via dot-notation
    const appliedKeys: string[] = []
    for (const [dotPath, value] of Object.entries(body.updates)) {
      setNestedValue(parsed, dotPath, value)
      appliedKeys.push(dotPath)
    }

    // Write back with pretty formatting
    await writeFile(configPath, JSON.stringify(parsed, null, 2) + '\n')

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'gateway_config_update',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { updated_keys: appliedKeys },
      ip_address: ipAddress,
    })

    return NextResponse.json({ updated: appliedKeys, count: appliedKeys.length })
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to update config: ${err.message}` }, { status: 500 })
  }
}

/** Set a value in a nested object using dot-notation path */
function setNestedValue(obj: any, path: string, value: any) {
  const keys = path.split('.')
  let current = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] === undefined) current[keys[i]] = {}
    current = current[keys[i]]
  }
  current[keys[keys.length - 1]] = value
}

/** Redact sensitive values for display */
function redactSensitive(obj: any, parentKey = ''): any {
  if (typeof obj !== 'object' || obj === null) return obj

  const sensitiveKeys = ['password', 'secret', 'token', 'api_key', 'apiKey']

  for (const key of Object.keys(obj)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      if (typeof obj[key] === 'string' && obj[key].length > 0) {
        obj[key] = '••••••••'
      }
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      redactSensitive(obj[key], key)
    }
  }

  return obj
}
