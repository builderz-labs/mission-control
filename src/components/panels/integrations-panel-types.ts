// Types shared across the integrations panel and its sub-components

export interface EnvVarInfo {
  redacted: string
  set: boolean
}

export interface Integration {
  id: string
  name: string
  category: string
  categoryLabel: string
  envVars: Record<string, EnvVarInfo>
  status: 'connected' | 'partial' | 'not_configured'
  vaultItem: string | null
  testable: boolean
  recommendation?: string | null
}

export interface Category {
  id: string
  label: string
}
