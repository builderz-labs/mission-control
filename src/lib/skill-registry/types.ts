/**
 * Skill Registry — shared type definitions
 */

export type RegistrySource = 'clawhub' | 'skills-sh' | 'awesome-openclaw'

export interface RegistrySkill {
  slug: string
  name: string
  description: string
  author: string
  version: string
  source: RegistrySource
  installCount?: number
  tags?: string[]
  hash?: string
  url?: string
}

export interface RegistrySearchResult {
  skills: RegistrySkill[]
  total: number
  source: RegistrySource
}

export interface InstallRequest {
  source: RegistrySource
  slug: string
  targetRoot: string
}

export interface InstallResult {
  ok: boolean
  name: string
  path: string
  message: string
  securityReport?: SecurityReport
}

export interface SecurityReport {
  status: 'clean' | 'warning' | 'rejected'
  issues: SecurityIssue[]
}

export interface SecurityIssue {
  severity: 'info' | 'warning' | 'critical'
  rule: string
  description: string
  line?: number
}
