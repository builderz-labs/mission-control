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

export interface SkillsPanelState {
  readonly loading: boolean
  readonly saving: boolean
  readonly error: string | null
  readonly query: string
  readonly activeRoot: string | null
  readonly selectedSkill: SkillSummary | null
  readonly selectedContent: SkillContentResponse | null
  readonly draftContent: string
  readonly drawerLoading: boolean
  readonly drawerError: string | null
  readonly createSource: string
  readonly createName: string
  readonly createContent: string
  readonly createError: string | null
  readonly isMounted: boolean
  readonly activeTab: PanelTab
  readonly registrySource: RegistrySource
  readonly registryQuery: string
  readonly registryResults: readonly RegistrySkill[]
  readonly registryLoading: boolean
  readonly registryError: string | null
  readonly registrySearched: boolean
  readonly installTarget: string
  readonly installing: string | null
  readonly installMessage: string | null
  readonly scanAll: ScanAllState | null
  readonly installModal: InstallModalState | null
  readonly filtered: readonly SkillSummary[]
}

export interface SkillsPanelActions {
  setQuery: (q: string) => void
  setActiveRoot: (root: string | null) => void
  setDraftContent: (content: string) => void
  setCreateSource: (source: string) => void
  setCreateName: (name: string) => void
  setCreateContent: (content: string) => void
  setScanAll: (state: ScanAllState | null) => void
  setActiveTab: (tab: PanelTab) => void
  setRegistrySource: (src: RegistrySource) => void
  setRegistryQuery: (q: string) => void
  setInstallTarget: (target: string) => void
  setInstallModal: (modal: InstallModalState | null) => void
  setSelectedSkill: (skill: SkillSummary | null) => void
  refresh: () => Promise<void>
  createSkill: () => Promise<void>
  saveSkill: () => Promise<void>
  deleteSkill: (skill: SkillSummary) => Promise<void>
  searchRegistry: () => Promise<void>
  installSkill: (slug: string) => Promise<void>
  checkSecurity: (skill: SkillSummary) => Promise<void>
  scanAllSkills: () => Promise<void>
}
