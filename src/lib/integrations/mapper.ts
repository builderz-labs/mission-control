/**
 * mapIntegration — converts an IntegrationDef into a MappedIntegration
 * by consulting env values, probe state, and provider subscriptions.
 */
import { detectProviderSubscriptions } from '@/lib/provider-subscriptions'
import type { IntegrationDef, MappedIntegration, IntegrationProbeSnapshot } from './types'
import { redactValue, getEffectiveEnvValue, isConfiguredValue } from './env-store'
import { checkOpAuthenticated } from './probes'

type VarMap = Record<string, { redacted: string; set: boolean }>

type MapCtx = {
  envMap: Map<string, string>
  probe: IntegrationProbeSnapshot
  providerSubscriptions: ReturnType<typeof detectProviderSubscriptions>
  allCategories: Record<string, { label: string; order: number }>
}

export function mapIntegration(def: IntegrationDef, ctx: MapCtx): MappedIntegration {
  const { envMap, probe, providerSubscriptions, allCategories } = ctx
  const { opAvailable, xint, ollamaInstalled, ollamaReachable, gwsInstalled } = probe

  let vars: VarMap = buildBaseVars(def, envMap)
  vars = applySpecialCases(def, vars, { envMap, opAvailable, xint, ollamaInstalled, ollamaReachable, gwsInstalled, providerSubscriptions })

  const anySet = Object.values(vars).some(v => v.set)
  const allSet = Object.values(vars).every(v => v.set) && anySet
  const status: MappedIntegration['status'] = allSet ? 'connected' : anySet ? 'partial' : 'not_configured'

  return {
    id: def.id, name: def.name, category: def.category,
    categoryLabel: allCategories[def.category]?.label ?? def.category,
    envVars: vars, status,
    vaultItem: def.vaultItem ?? null,
    testable: def.testable ?? false,
    recommendation: def.recommendation ?? null,
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildBaseVars(def: IntegrationDef, envMap: Map<string, string>): VarMap {
  let vars: VarMap = {}
  for (const envVar of def.envVars) {
    const val = getEffectiveEnvValue(envMap, envVar)
    vars = isConfiguredValue(envVar, val)
      ? { ...vars, [envVar]: { redacted: redactValue(val), set: true } }
      : { ...vars, [envVar]: { redacted: '', set: false } }
  }
  return vars
}

type SpecialCtx = {
  envMap: Map<string, string>
  opAvailable: boolean
  xint: IntegrationProbeSnapshot['xint']
  ollamaInstalled: boolean
  ollamaReachable: boolean
  gwsInstalled: boolean
  providerSubscriptions: ReturnType<typeof detectProviderSubscriptions>
}

function applySpecialCases(def: IntegrationDef, vars: VarMap, ctx: SpecialCtx): VarMap {
  const { envMap, opAvailable, xint, ollamaInstalled, ollamaReachable, gwsInstalled, providerSubscriptions } = ctx
  const anySet = Object.values(vars).some(v => v.set)

  if (def.id === 'onepassword' && !anySet && opAvailable) {
    const opEnvSync: NodeJS.ProcessEnv = { ...process.env }
    const fileToken = envMap.get('OP_SERVICE_ACCOUNT_TOKEN')
    if (fileToken) opEnvSync.OP_SERVICE_ACCOUNT_TOKEN = fileToken
    if (checkOpAuthenticated(opEnvSync)) {
      return { ...vars, OP_SERVICE_ACCOUNT_TOKEN: { redacted: fileToken ? redactValue(fileToken) : 'op session', set: true } }
    }
  }

  if ((def.id === 'anthropic' || def.id === 'openai') && !anySet) {
    const sub = providerSubscriptions.active[def.id]
    if (sub) return { ...vars, [def.envVars[0]]: { redacted: `${sub.type} (${sub.source})`, set: true } }
  }

  if (def.id === 'ollama' && !anySet) {
    if (ollamaReachable) return { ...vars, [def.envVars[0]]: { redacted: 'local daemon', set: true } }
    if (ollamaInstalled) return { ...vars, [def.envVars[0]]: { redacted: 'installed (daemon not reachable)', set: true } }
  }

  if (def.id === 'google_workspace' && !anySet && gwsInstalled) {
    return { ...vars, [def.envVars[0]]: { redacted: 'gws CLI installed (run `gws auth login`)', set: true } }
  }

  if (def.id === 'x_twitter' && !anySet) {
    if (xint.oauthConfigured) return { ...vars, [def.envVars[0]]: { redacted: 'xint oauth', set: true } }
    if (xint.installed || xint.envConfigured) return { ...vars, [def.envVars[0]]: { redacted: 'xint installed (run `xint auth`)', set: true } }
  }

  return vars
}
