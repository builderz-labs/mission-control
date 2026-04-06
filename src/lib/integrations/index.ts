/**
 * Public barrel — re-exports every symbol that external modules consume.
 * Import from '@/lib/integrations-registry' (which re-exports this) or
 * directly from '@/lib/integrations' for the sub-module path.
 */
export type { BuiltinCategory, IntegrationDef, IntegrationProbeSnapshot, EnvLine, MappedIntegration } from './types'
export { INTEGRATIONS, CATEGORIES, BLOCKED_VARS, BLOCKED_PREFIXES } from './types'
export { parseEnv, serializeEnv, getEnvPath, readEnvFile, writeEnvFile, redactValue, isVarBlocked, getEffectiveEnvValue, isPathLikeEnvVar, isConfiguredValue } from './env-store'
export { checkOpAvailable, checkOpAuthenticated, checkCommandAvailable, checkXintState, resolveOllamaBaseUrl, checkOllamaReachable, getIntegrationProbeSnapshot, getOpEnv } from './probes'
export { handleTest, handlePull, handlePullAll, buildIntegrationList } from './handlers'
