export interface SkillSummary {
  id: string
  name: string
  source: string
  path: string
  description?: string
  registry_slug?: string | null
  security_status?: string | null
}

export interface SkillGroup {
  source: string
  path: string
  skills: SkillSummary[]
}

export interface SkillsResponse {
  skills: SkillSummary[]
  groups: SkillGroup[]
  total: number
}

export interface SkillContentResponse {
  source: string
  name: string
  skillPath: string
  skillDocPath: string
  content: string
  security?: {
    status: string
    issues: Array<{
      severity: string
      rule: string
      description: string
      line?: number
    }>
  }
}

export interface RegistrySkill {
  slug: string
  name: string
  description: string
  author: string
  version: string
  source: string
  installCount?: number
  tags?: string[]
}

export type PanelTab = 'installed' | 'registry'

export type RegistrySource = 'clawhub' | 'skills-sh' | 'awesome-openclaw'

export interface ScanAllState {
  running: boolean
  total: number
  done: number
  current: string | null
  results: { clean: number; warning: number; rejected: number; error: number }
}

export interface InstallModalState {
  slug: string
  name: string
  step: 'fetching' | 'scanning' | 'writing' | 'done' | 'error'
  message?: string
  securityStatus?: string
}
