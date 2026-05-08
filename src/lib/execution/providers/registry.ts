/**
 * Execution Provider Registry
 *
 * Maintains the set of registered execution providers and the default.
 * OpenClaw is registered as the default at module load time.
 */

import type { ExecutionProvider, ProviderInfo } from './types'
import { OpenClawProvider } from './openclaw-provider'

export interface ProviderValidationResult {
  provider: string
  available: boolean
  info?: ProviderInfo
  error?: string
}

const _registry = new Map<string, ExecutionProvider>()
let _defaultId: string | null = null

export function registerProvider(provider: ExecutionProvider, isDefault = false): void {
  _registry.set(provider.id, provider)
  if (isDefault || _registry.size === 1) {
    _defaultId = provider.id
  }
}

/** Get a provider by id, or the default provider if id is omitted. Returns null if not found. */
export function getProvider(id?: string): ExecutionProvider | null {
  const key = id ?? _defaultId
  if (!key) return null
  return _registry.get(key) ?? null
}

/** Get the default provider. Throws if no provider is registered. */
export function getDefaultProvider(): ExecutionProvider {
  const provider = getProvider()
  if (!provider) {
    throw new Error('No execution provider registered. Ensure registerProvider() has been called.')
  }
  return provider
}

/** List all registered provider ids. */
export function listProviders(): string[] {
  return Array.from(_registry.keys())
}

/**
 * Validate the default (or named) provider is available and declares capabilities.
 * Safe to call at startup — never throws, returns structured result.
 */
export async function validateProvider(id?: string): Promise<ProviderValidationResult> {
  const provider = getProvider(id)
  if (!provider) {
    return { provider: id ?? '(none)', available: false, error: 'Provider not registered' }
  }
  try {
    const result = await provider.info()
    if (!result.ok) {
      return { provider: provider.id, available: false, error: result.error.message }
    }
    return { provider: provider.id, available: true, info: result.data }
  } catch (err) {
    return {
      provider: provider.id,
      available: false,
      error: err instanceof Error ? err.message : 'Provider info check threw unexpectedly',
    }
  }
}

// Register OpenClaw as the default provider at module initialization.
registerProvider(new OpenClawProvider(), true)
