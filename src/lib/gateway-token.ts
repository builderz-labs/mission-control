import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from '@/lib/config'

const TOKEN_CACHE_MS = 30_000
const OBJECT_STRING = '[object Object]'

interface SecretRef {
  source?: unknown
  id?: unknown
}

let cachedToken: { value: string; at: number } | null = null

export function isUsableGatewayToken(token: unknown): token is string {
  if (typeof token !== 'string') return false
  const value = token.trim()
  if (value.length < 8) return false
  if (value === OBJECT_STRING) return false
  if (value.startsWith('{') && /"source"\s*:/.test(value)) return false
  return true
}

export function readSecretRefId(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const id = (value as SecretRef).id
  return typeof id === 'string' ? id.trim() : ''
}

export function resolveGatewayCredential(
  value: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
  stateDir = config.openclawStateDir,
): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return isUsableGatewayToken(trimmed) ? trimmed : ''
  }

  const id = readSecretRefId(value)
  if (!id) return ''

  const fromEnv = String(env[id] || '').trim()
  if (isUsableGatewayToken(fromEnv)) return fromEnv

  const source = (value as SecretRef).source
  if (source === 'store') {
    const fromStore = readStoreSecret(id, stateDir)
    if (isUsableGatewayToken(fromStore)) return fromStore
  }

  return ''
}

export function readStoreSecret(name: string, stateDir = config.openclawStateDir): string {
  if (!name || !stateDir) return ''
  const dbPath = path.join(stateDir, 'state', 'openclaw.sqlite')
  if (!fs.existsSync(dbPath)) return ''

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 500 })
    try {
      const row = db.prepare(
        'SELECT value FROM secret_store_entries WHERE name = ? AND deleted_at_ms IS NULL LIMIT 1',
      ).get(name) as { value?: unknown } | undefined
      return typeof row?.value === 'string' ? row.value.trim() : ''
    } finally {
      db.close()
    }
  } catch {
    return ''
  }
}

export function cachedGatewayToken(resolve: () => string): string {
  const now = Date.now()
  if (cachedToken && now - cachedToken.at < TOKEN_CACHE_MS && isUsableGatewayToken(cachedToken.value)) {
    return cachedToken.value
  }
  const value = resolve()
  if (isUsableGatewayToken(value)) {
    cachedToken = { value, at: now }
    return value
  }
  cachedToken = null
  return ''
}
