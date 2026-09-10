import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isUsableGatewayToken,
  readSecretRefId,
  resolveGatewayCredential,
} from '@/lib/gateway-token'

describe('gateway token resolution', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    tempDir = ''
  })

  it('rejects object-stringified and secret-ref JSON tokens', () => {
    expect(isUsableGatewayToken('[object Object]')).toBe(false)
    expect(isUsableGatewayToken('{"source":"store","id":"OPENCLAW_GATEWAY_TOKEN"}')).toBe(false)
    expect(isUsableGatewayToken('short')).toBe(false)
    expect(isUsableGatewayToken('gateway-token-value-ok')).toBe(true)
  })

  it('reads a SecretRef id without stringifying the object', () => {
    expect(readSecretRefId({ source: 'store', id: 'OPENCLAW_GATEWAY_TOKEN' })).toBe('OPENCLAW_GATEWAY_TOKEN')
    expect(readSecretRefId('plaintext')).toBe('')
  })

  it('resolves env SecretRefs and ignores object stringification', () => {
    const env = { OPENCLAW_GATEWAY_TOKEN: 'env-token-from-ref-ok' }
    expect(resolveGatewayCredential({ source: 'env', id: 'OPENCLAW_GATEWAY_TOKEN' }, env, '/tmp/mc-missing-openclaw-state')).toBe('env-token-from-ref-ok')
    expect(resolveGatewayCredential({ source: 'store', provider: 'default', id: 'OPENCLAW_GATEWAY_TOKEN' }, {}, '/tmp/mc-missing-openclaw-state')).toBe('')
  })

  it('resolves store SecretRefs from the OpenClaw sqlite secret table', () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-gateway-token-'))
    const stateDir = path.join(tempDir, 'state')
    mkdirSync(stateDir, { recursive: true })
    const db = new Database(path.join(tempDir, 'state', 'openclaw.sqlite'))
    db.exec(`
      CREATE TABLE secret_store_entries (
        name TEXT PRIMARY KEY,
        value TEXT,
        deleted_at_ms INTEGER
      )
    `)
    db.prepare('INSERT INTO secret_store_entries (name, value, deleted_at_ms) VALUES (?, ?, NULL)')
      .run('OPENCLAW_GATEWAY_TOKEN', 'store-token-from-sqlite-ok')
    db.close()

    const resolved = resolveGatewayCredential(
      { source: 'store', provider: 'default', id: 'OPENCLAW_GATEWAY_TOKEN' },
      {},
      tempDir,
    )
    expect(resolved).toBe('store-token-from-sqlite-ok')
  })
})
