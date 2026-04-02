import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { config } from '@/lib/config'
import { validateBody, gatewayConfigUpdateSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { getDetectedGatewayToken } from '@/lib/gateway-runtime'
import { parseJsonRelaxed } from '@/lib/json-relaxed'

function getConfigPath(): string | null {
  return config.openclawConfigPath || null
}

function gatewayUrl(path: string): string {
  return `http://${config.gatewayHost}:${config.gatewayPort}${path}`
}

function gatewayHeaders(): Record<string, string> {
  const token = getDetectedGatewayToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

function computeHash(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/**
 * GET /api/gateway-config - Read the gateway configuration
 * GET /api/gateway-config?action=schema - Get the config JSON schema
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const action = request.nextUrl.searchParams.get('action')

  if (action === 'schema') {
    return getSchema()
  }

  const configPath = getConfigPath()
  if (!configPath) {
    return NextResponse.json({ error: 'OPENCLAW_CONFIG_PATH not configured' }, { status: 404 })
  }

  try {
    const { readFile } = require('fs/promises')
    const raw = await readFile(configPath, 'utf-8')
    const parsed = parseJsonRelaxed<Record<string, unknown>>(raw)
    const hash = computeHash(raw)

    // Redact sensitive fields for display
    const redacted = redactSensitive(JSON.parse(JSON.stringify(parsed)))

    return NextResponse.json({
      path: configPath,
      config: redacted,
      raw_size: raw.length,
      hash,
    })
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return NextResponse.json({ error: 'Config file not found', path: configPath }, { status: 404 })
    }
    return NextResponse.json({ error: `Failed to read config: ${err.message}` }, { status: 500 })
  }
}

async function getSchema(): Promise<NextResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(gatewayUrl('/api/config/schema'), {
      signal: controller.signal,
      headers: gatewayHeaders(),
    })
    clearTimeout(timeout)
    if (!res.ok) {
      return NextResponse.json(
        { error: `Gateway returned ${res.status}` },
        { status: 502 },
      )
    }
    const data = await res.json()
    return NextResponse.json(data)
  } catch (err: any) {
    clearTimeout(timeout)
    return NextResponse.json(
      { error: err.name === 'AbortError' ? 'Gateway timeout' : 'Gateway unreachable' },
      { status: 502 },
    )
  }
}

/**
 * PUT /api/gateway-config - Update specific config fields
 * PUT /api/gateway-config?action=apply - Hot-apply config via gateway RPC
 * PUT /api/gateway-config?action=update - System update via gateway RPC
 *
 * Body: { updates: { "path.to.key": value, ... }, hash?: string }
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const action = request.nextUrl.searchParams.get('action')

  if (action === 'apply') {
    return applyConfig(request, auth)
  }

  if (action === 'update') {
    return updateSystem(request, auth)
  }

  const configPath = getConfigPath()
  if (!configPath) {
    return NextResponse.json({ error: 'OPENCLAW_CONFIG_PATH not configured' }, { status: 404 })
  }

  const result = await validateBody(request, gatewayConfigUpdateSchema)
  if ('error' in result) return result.error
  const body = result.data

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

    // Hash-based concurrency check
    const clientHash = (body as any).hash
    if (clientHash) {
      const serverHash = computeHash(raw)
      if (clientHash !== serverHash) {
        return NextResponse.json(
          { error: 'Config has been modified by another user. Please reload and try again.', code: 'CONFLICT' },
          { status: 409 },
        )
      }
    }

    const parsed = parseJsonRelaxed<Record<string, unknown>>(raw)

    for (const dotPath of Object.keys(body.updates)) {
      const [rootKey] = dotPath.split('.')
      if (!rootKey || !(rootKey in parsed)) {
        return NextResponse.json(
          { error: `Unknown config root: ${rootKey || dotPath}` },
          { status: 400 },
        )
      }
    }

    // Apply updates via dot-notation
    const appliedKeys: string[] = []
    for (const [dotPath, value] of Object.entries(body.updates)) {
      setNestedValue(parsed, dotPath, value)
      appliedKeys.push(dotPath)
    }

    // Write back with pretty formatting
    const newRaw = JSON.stringify(parsed, null, 2) + '\n'
    await writeFile(configPath, newRaw)

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'gateway_config_update',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { updated_keys: appliedKeys },
      ip_address: ipAddress,
    })

    return NextResponse.json({
      updated: appliedKeys,
      count: appliedKeys.length,
      hash: computeHash(newRaw),
    })
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to update config: ${err.message}` }, { status: 500 })
  }
}

async function applyConfig(request: NextRequest, auth: any): Promise<NextResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(gatewayUrl('/api/config/apply'), {
      method: 'POST',
      signal: controller.signal,
      headers: gatewayHeaders(),
    })
    clearTimeout(timeout)

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'gateway_config_apply',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { status: res.status },
      ip_address: ipAddress,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json(
        { error: `Apply failed (${res.status}): ${text}` },
        { status: 502 },
      )
    }
    const data = await res.json().catch(() => ({}))
    return NextResponse.json({ ok: true, ...data })
  } catch (err: any) {
    clearTimeout(timeout)
    return NextResponse.json(
      { error: err.name === 'AbortError' ? 'Gateway timeout' : 'Gateway unreachable' },
      { status: 502 },
    )
  }
}

async function updateSystem(request: NextRequest, auth: any): Promise<NextResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(gatewayUrl('/api/config/update'), {
      method: 'POST',
      signal: controller.signal,
      headers: gatewayHeaders(),
    })
    clearTimeout(timeout)

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'gateway_config_system_update',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { status: res.status },
      ip_address: ipAddress,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json(
        { error: `Update failed (${res.status}): ${text}` },
        { status: 502 },
      )
    }
    const data = await res.json().catch(() => ({}))
    return NextResponse.json({ ok: true, ...data })
  } catch (err: any) {
    clearTimeout(timeout)
    return NextResponse.json(
      { error: err.name === 'AbortError' ? 'Gateway timeout' : 'Gateway unreachable' },
      { status: 502 },
    )
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
        obj[key] = '--------'
      }
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      redactSensitive(obj[key], key)
    }
  }

  return obj
}
