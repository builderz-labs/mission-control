/**
 * Plugin Registry
 *
 * Module-scoped registries following the existing register*() pattern
 * (see registerAuthResolver in auth.ts, registerMigrations in migrations.ts).
 *
 * Plugins call register* functions at init time to extend integrations,
 * categories, nav items, panels, and tool providers.
 */

import type { ComponentType } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginIntegrationDef {
  id: string
  name: string
  category: string
  envVars: string[]
  vaultItem?: string
  testable?: boolean
  recommendation?: string
  testHandler?: (envMap: Map<string, string>) => Promise<{ ok: boolean; detail: string }>
}

export interface PluginCategory {
  id: string
  label: string
  order: number
}

export interface PluginNavItem {
  id: string
  label: string
  icon?: string
  groupId: string
  gatewayOnly?: boolean
}

export interface PluginToolProvider {
  id: string
  name: string
  tools: string[]
  requiredIntegration?: string
}

// ---------------------------------------------------------------------------
// Registries (module-scoped)
// ---------------------------------------------------------------------------

const _integrations: PluginIntegrationDef[] = []
const _categories: PluginCategory[] = []
const _navItems: PluginNavItem[] = []
const _panels: Map<string, ComponentType> = new Map()
const _toolProviders: PluginToolProvider[] = []

// ---------------------------------------------------------------------------
// Integration registry
// ---------------------------------------------------------------------------

export function registerIntegrations(defs: PluginIntegrationDef[]): void {
  _integrations.push(...defs)
}

export function getPluginIntegrations(): PluginIntegrationDef[] {
  return _integrations
}

// ---------------------------------------------------------------------------
// Category registry
// ---------------------------------------------------------------------------

export function registerCategories(cats: PluginCategory[]): void {
  _categories.push(...cats)
}

export function getPluginCategories(): PluginCategory[] {
  return _categories
}

// ---------------------------------------------------------------------------
// Nav item registry
// ---------------------------------------------------------------------------

export function registerNavItems(items: PluginNavItem[]): void {
  _navItems.push(...items)
}

export function getPluginNavItems(): PluginNavItem[] {
  return _navItems
}

// ---------------------------------------------------------------------------
// Panel registry
// ---------------------------------------------------------------------------

export function registerPanel(id: string, component: ComponentType): void {
  _panels.set(id, component)
}

export function getPluginPanel(id: string): ComponentType | undefined {
  return _panels.get(id)
}

export function getPluginPanelIds(): string[] {
  return Array.from(_panels.keys())
}

// ---------------------------------------------------------------------------
// Tool provider registry
// ---------------------------------------------------------------------------

export function registerToolProviders(provs: PluginToolProvider[]): void {
  _toolProviders.push(...provs)
}

export function getPluginToolProviders(): PluginToolProvider[] {
  return _toolProviders
}
