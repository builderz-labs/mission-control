// Internal helpers shared by provision-plans and tenant-jobs.
// None of these are exported from the package barrel — they are
// implementation details not intended for external callers.

import fs from 'fs'
import path from 'path'
import { config as appConfig } from '../config'

export function getTenantHomeRoot(): string {
  return String(process.env.MC_TENANT_HOME_ROOT || '/home').trim() || '/home'
}

export function getTenantWorkspaceDirname(): string {
  return String(process.env.MC_TENANT_WORKSPACE_DIRNAME || 'workspace').trim() || 'workspace'
}

export function joinPosix(...parts: string[]): string {
  const cleaned = parts.map((p) => String(p || '').replace(/\/+$/g, ''))
  return path.posix.join(...cleaned)
}

export function normalizeSlug(input: string): string {
  return (input || '').trim().toLowerCase()
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)
}

export function ensurePort(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1024 || n > 65535) {
    throw new Error('Port must be an integer between 1024 and 65535')
  }
  return n
}

export function normalizeOwnerGateway(value: unknown, _slug: string): string {
  const raw = String(value || '').trim()
  const fallback =
    String(
      process.env.MC_DEFAULT_OWNER_GATEWAY ||
      process.env.MC_DEFAULT_GATEWAY_NAME ||
      'primary',
    ).trim() || 'primary'
  if (!raw) return fallback
  if (raw.length > 120) throw new Error('owner_gateway is too long')
  return raw
}

export function parseJsonField<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function parseJobRequest(job: Record<string, unknown>): { dry_run?: boolean } {
  const raw = job?.request_json
  if (raw && typeof raw === 'object') return raw as { dry_run?: boolean }
  return parseJsonField(typeof raw === 'string' ? raw : null, {})
}

export function getProvisionArtifactDir(slug: string): string {
  return path.join(appConfig.dataDir, 'provisioner', slug)
}

export function ensureProvisionArtifacts(job: Record<string, unknown>): void {
  const requestJson = parseJobRequest(job) as Record<string, unknown>
  const slug = String(requestJson?.slug || job?.tenant_slug || '').trim()
  const linuxUser = String(job?.linux_user || '').trim()
  const openclawHome = String(job?.openclaw_home || '').trim()
  const gatewayPort = Number(
    requestJson?.gateway_port ?? job?.gateway_port ?? 0,
  )

  if (!slug) throw new Error('Missing tenant slug for artifact generation')
  if (!linuxUser) throw new Error('Missing linux_user for artifact generation')
  if (!openclawHome) throw new Error('Missing openclaw_home for artifact generation')
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1024 || gatewayPort > 65535) {
    throw new Error('Missing/invalid gateway_port for gateway unit provisioning')
  }

  const artifactDir = getProvisionArtifactDir(slug)
  fs.mkdirSync(artifactDir, { recursive: true })

  const gatewayEnv = [
    `TENANT_SLUG=${slug}`,
    `TENANT_USER=${linuxUser}`,
    `OPENCLAW_HOME=${openclawHome}`,
    `OPENCLAW_STATE_DIR=${openclawHome}`,
    `OPENCLAW_CONFIG_PATH=${openclawHome}/openclaw.json`,
    `OPENCLAW_GATEWAY_PORT=${gatewayPort}`,
    '',
  ].join('\n')

  fs.writeFileSync(path.join(artifactDir, 'openclaw-gateway.env'), gatewayEnv, {
    mode: 0o600,
  })
}
