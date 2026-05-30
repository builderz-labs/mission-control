import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Point scanOpenClaw at a real temp openclaw.json by overriding only the
// openclawConfigPath field of the config module (every other field stays real,
// so the credentials/network/os/runtime scanners behave normally and don't crash).
const { tmpConfigPath } = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs')
  const os = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-secscan-'))
  return { tmpConfigPath: path.join(dir, 'openclaw.json') }
})

vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config')>()
  return {
    ...actual,
    config: { ...actual.config, openclawConfigPath: tmpConfigPath },
  }
})

import { runSecurityScan } from '@/lib/security-scan'

function writeOpenClawConfig(value: unknown) {
  writeFileSync(tmpConfigPath, JSON.stringify(value), 'utf-8')
}

function gatewayAuthStatus() {
  const result = runSecurityScan()
  return result.categories.openclaw.checks.find(c => c.id === 'gateway_auth')?.status
}

describe('scanOpenClaw — gateway_auth credential handling', () => {
  beforeEach(() => {
    writeOpenClawConfig({})
  })
  afterAll(() => {
    rmSync(join(tmpConfigPath, '..'), { recursive: true, force: true })
  })

  it('does not crash and passes when token is a SecretRef object (regression for #670)', () => {
    writeOpenClawConfig({
      gateway: { auth: { mode: 'token', token: { source: 'file', path: '/secrets/gateway-token' } } },
    })
    expect(() => runSecurityScan()).not.toThrow()
    expect(gatewayAuthStatus()).toBe('pass')
  })

  it('passes when password is a SecretRef object', () => {
    writeOpenClawConfig({
      gateway: { auth: { mode: 'password', password: { source: 'vault', ref: 'op://vault/item' } } },
    })
    expect(gatewayAuthStatus()).toBe('pass')
  })

  it('passes when token is a non-empty plain string', () => {
    writeOpenClawConfig({
      gateway: { auth: { mode: 'token', token: 'plain-secret-token' } },
    })
    expect(gatewayAuthStatus()).toBe('pass')
  })

  it('fails when token mode is set but token is an empty string', () => {
    writeOpenClawConfig({
      gateway: { auth: { mode: 'token', token: '' } },
    })
    expect(gatewayAuthStatus()).toBe('fail')
  })

  it('fails when token mode is set but token is missing', () => {
    writeOpenClawConfig({
      gateway: { auth: { mode: 'token' } },
    })
    expect(gatewayAuthStatus()).toBe('fail')
  })
})
