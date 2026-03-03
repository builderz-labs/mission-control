/**
 * Gateway adapter registry.
 *
 * Manages available gateway adapters and provides factory methods
 * for creating adapter instances by type.
 */

import type { GatewayAdapter, GatewayType } from './types'

type AdapterFactory = () => GatewayAdapter

const adapters = new Map<GatewayType, AdapterFactory>()

/**
 * Register a gateway adapter factory.
 */
export function registerAdapter(type: GatewayType, factory: AdapterFactory): void {
  adapters.set(type, factory)
}

/**
 * Create a gateway adapter instance by type.
 */
export function createAdapter(type: GatewayType): GatewayAdapter {
  const factory = adapters.get(type)
  if (!factory) {
    throw new Error(`No gateway adapter registered for type: ${type}. Available: ${getRegisteredTypes().join(', ')}`)
  }
  return factory()
}

/**
 * Check if an adapter is registered for a given type.
 */
export function hasAdapter(type: GatewayType): boolean {
  return adapters.has(type)
}

/**
 * Get all registered adapter types.
 */
export function getRegisteredTypes(): GatewayType[] {
  return Array.from(adapters.keys())
}

/**
 * Get adapter metadata for all registered types.
 */
export function getAdapterInfo(): Array<{ type: GatewayType; displayName: string }> {
  return Array.from(adapters.entries()).map(([type, factory]) => {
    const instance = factory()
    return { type, displayName: instance.displayName }
  })
}
