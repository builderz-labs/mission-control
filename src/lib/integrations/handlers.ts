/**
 * HTTP sub-handlers for the integrations API route.
 * Each exported function is called by the slim route handler in
 * src/app/api/integrations/route.ts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { execFileSync } from 'child_process'
import { logAuditEvent } from '@/lib/db'
import { getErrorMessage } from '@/lib/types/sql'
import { detectProviderSubscriptions } from '@/lib/provider-subscriptions'
import { getPluginIntegrations, getPluginCategories } from '@/lib/plugins'
import type { PluginIntegrationDef } from '@/lib/plugins'
import type { IntegrationDef, MappedIntegration, EnvLine } from './types'
import { INTEGRATIONS, CATEGORIES } from './types'
import { readEnvFile, writeEnvFile, redactValue, getEnvPath } from './env-store'
import { checkOpAvailable, getIntegrationProbeSnapshot, getOpEnv } from './probes'
import { runIntegrationTest } from './testers'
import { mapIntegration } from './mapper'

// ---------------------------------------------------------------------------
// handleTest
// ---------------------------------------------------------------------------

export async function handleTest(
  integration: IntegrationDef,
  request: NextRequest,
  user: { username: string; id: number },
): Promise<NextResponse> {
  if (!integration.testable) {
    return NextResponse.json({ error: 'This integration does not support testing' }, { status: 400 })
  }

  const envData = await readEnvFile()
  if (!envData) {
    return NextResponse.json({ error: 'OPENCLAW_STATE_DIR not configured' }, { status: 404 })
  }

  try {
    const result = await runIntegrationTest(integration, buildEnvMap(envData.lines))
    logAuditEvent({
      action: 'integration_test',
      actor: user.username,
      actor_id: user.id,
      detail: { integration: integration.id, result: result.ok ? 'success' : 'failed' },
      ip_address: extractIp(request),
    })
    return NextResponse.json(result)
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, detail: getErrorMessage(err) || 'Connection failed' })
  }
}

// ---------------------------------------------------------------------------
// handlePull — pull a single integration from 1Password
// ---------------------------------------------------------------------------

export async function handlePull(
  integration: IntegrationDef,
  request: NextRequest,
  user: { username: string; id: number },
): Promise<NextResponse> {
  if (!integration.vaultItem) {
    return NextResponse.json({ error: 'No vault item configured for this integration' }, { status: 400 })
  }
  if (!checkOpAvailable()) {
    return NextResponse.json({ error: '1Password CLI (op) is not installed' }, { status: 400 })
  }

  try {
    const opEnv = await getOpEnv()
    if (!opEnv.OP_SERVICE_ACCOUNT_TOKEN) {
      return NextResponse.json({ error: 'OP_SERVICE_ACCOUNT_TOKEN not found in environment or .env' }, { status: 400 })
    }

    const value = fetchOpSecret(integration.vaultItem, opEnv)
    if (!value) return NextResponse.json({ error: 'Empty value returned from 1Password' }, { status: 400 })

    const envData = await readEnvFile()
    if (!envData) {
      return NextResponse.json({ error: 'OPENCLAW_STATE_DIR not configured' }, { status: 404 })
    }

    const envVar = integration.envVars[0]
    await writeEnvFile(upsertEnvLine(envData.lines, envVar, value))

    logAuditEvent({
      action: 'integration_pull_1password',
      actor: user.username,
      actor_id: user.id,
      detail: { integration: integration.id, env_var: envVar },
      ip_address: extractIp(request),
    })
    return NextResponse.json({ ok: true, detail: `Pulled ${envVar} from 1Password`, redacted: redactValue(value) })
  } catch (err: unknown) {
    return NextResponse.json({ error: `1Password pull failed: ${getErrorMessage(err)}` }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// handlePullAll — pull all vault-backed integrations (optionally by category)
// ---------------------------------------------------------------------------

export async function handlePullAll(
  request: NextRequest,
  user: { username: string; id: number },
  category?: string,
): Promise<NextResponse> {
  if (!checkOpAvailable()) {
    return NextResponse.json({ error: '1Password CLI (op) is not installed' }, { status: 400 })
  }

  const opEnv = await getOpEnv()
  if (!opEnv.OP_SERVICE_ACCOUNT_TOKEN) {
    return NextResponse.json({ error: 'OP_SERVICE_ACCOUNT_TOKEN not found in environment or .env' }, { status: 400 })
  }

  const targets = INTEGRATIONS.filter(i => i.vaultItem && (!category || i.category === category))
  if (targets.length === 0) {
    return NextResponse.json({ error: 'No vault-backed integrations found for this category' }, { status: 400 })
  }

  const envData = await readEnvFile()
  if (!envData) {
    return NextResponse.json({ error: 'OPENCLAW_STATE_DIR not configured' }, { status: 404 })
  }

  let lines = envData.lines
  const results: { id: string; envVar: string; ok: boolean; detail: string }[] = []

  for (const integration of targets) {
    const envVar = integration.envVars[0]
    try {
      const value = fetchOpSecret(integration.vaultItem!, opEnv)
      if (!value) {
        results.push({ id: integration.id, envVar, ok: false, detail: 'Empty value' })
        continue
      }
      lines = upsertEnvLine(lines, envVar, value)
      results.push({ id: integration.id, envVar, ok: true, detail: `Pulled ${envVar}` })
    } catch (err: unknown) {
      results.push({ id: integration.id, envVar, ok: false, detail: getErrorMessage(err) || 'Failed' })
    }
  }

  const successCount = results.filter(r => r.ok).length
  if (successCount > 0) await writeEnvFile(lines)

  logAuditEvent({
    action: 'integration_pull_all_1password',
    actor: user.username,
    actor_id: user.id,
    detail: {
      category: category ?? 'all',
      success: successCount,
      failed: results.length - successCount,
      results: results.map(r => ({ id: r.id, ok: r.ok })),
    },
    ip_address: extractIp(request),
  })

  return NextResponse.json({
    ok: successCount > 0,
    detail: `Pulled ${successCount}/${results.length} integrations`,
    results,
  })
}

// ---------------------------------------------------------------------------
// buildIntegrationList — shared GET helper
// ---------------------------------------------------------------------------

export async function buildIntegrationList(): Promise<NextResponse | {
  integrations: MappedIntegration[]
  categories: { id: string; label: string }[]
  opAvailable: boolean
  envAvailable: boolean
}> {
  const envData = await readEnvFile()
  if (!envData) {
    return NextResponse.json({ error: 'OPENCLAW_STATE_DIR not configured' }, { status: 404 })
  }

  const envMap = buildEnvMap(envData.lines)
  const probe = await getIntegrationProbeSnapshot()
  const providerSubscriptions = detectProviderSubscriptions()

  const allIntegrations: IntegrationDef[] = [...INTEGRATIONS]
  const pluginIntegrations = getPluginIntegrations()
  const pluginIntegrationMap = new Map<string, PluginIntegrationDef>()

  for (const pi of pluginIntegrations) {
    if (!allIntegrations.some(i => i.id === pi.id)) {
      allIntegrations.push({
        id: pi.id, name: pi.name, category: pi.category,
        envVars: pi.envVars, vaultItem: pi.vaultItem,
        testable: pi.testable, recommendation: pi.recommendation,
      })
    }
    pluginIntegrationMap.set(pi.id, pi)
  }

  const allCategories = { ...CATEGORIES }
  for (const pc of getPluginCategories()) {
    if (!(pc.id in allCategories)) {
      allCategories[pc.id] = { label: pc.label, order: pc.order }
    }
  }

  const ctx = { envMap, probe, providerSubscriptions, allCategories }
  const integrations = allIntegrations.map(def => mapIntegration(def, ctx))

  return {
    integrations,
    categories: Object.entries(allCategories)
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([id, meta]) => ({ id, label: meta.label })),
    opAvailable: probe.opAvailable,
    envAvailable: !!getEnvPath(),
  }
}

// ---------------------------------------------------------------------------
// File-local utilities
// ---------------------------------------------------------------------------

function buildEnvMap(lines: EnvLine[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of lines) {
    if (line.type === 'var' && line.key) map.set(line.key, line.value!)
  }
  return map
}

/** Immutable upsert: returns a new array with the given key set to value. */
function upsertEnvLine(lines: EnvLine[], key: string, value: string): EnvLine[] {
  const idx = lines.findIndex(l => l.type === 'var' && l.key === key)
  if (idx !== -1) {
    return lines.map((l, i) => (i === idx ? { ...l, value } : l))
  }
  const needsBlank = lines.length > 0 && lines[lines.length - 1].type !== 'blank'
  return [
    ...lines,
    ...(needsBlank ? [{ type: 'blank' as const, raw: '' }] : []),
    { type: 'var' as const, raw: `${key}=${value}`, key, value },
  ]
}

function extractIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown'
}

/** Synchronously fetch a single secret from 1Password. */
function fetchOpSecret(vaultItem: string, opEnv: NodeJS.ProcessEnv): string {
  const raw = execFileSync('op', [
    'item', 'get', vaultItem,
    '--vault', process.env.OP_VAULT_NAME ?? 'default',
    '--fields', 'password',
    '--format', 'json',
  ], { timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'], env: opEnv }).toString().trim()

  try {
    const parsed = JSON.parse(raw) as { value?: string }
    return parsed.value ?? raw
  } catch {
    return raw
  }
}
