export interface ForgeProject {
  projectName: string
  repoName: string
  path: string
  stack: string[]
  status: string
  description: string
  owner: string
  architectureMaturity: string
  lastKnownFocus: string
  roleInForge: string[]
  summaryPath: string
}

export interface ForgeModule {
  id: string
  name: string
  internalIdentity: string
  path: string
  purpose: string
  uiRoute: string
  status: string
}

export interface ForgeAgent {
  id: string
  name: string
  path: string
  role: string
}

export interface ForgeChecklistCounts {
  done: number
  open: number
}

export interface ForgeDocStatus {
  label: string
  path: string
  present: string[]
  missing: string[]
  complete: boolean
  checklist: ForgeChecklistCounts
}

export interface ForgeModuleWithDocs extends ForgeModule {
  docs: ForgeDocStatus
}

export interface ForgePlatformData {
  brand: string
  internalIdentity: string
  tagline: string
  projects: ForgeProject[]
  agents: ForgeAgent[]
  modules: ForgeModuleWithDocs[]
  rootDocs: ForgeDocStatus
  memoryAssets: string[]
  totalOpenTasks: number
  totalCompletedTasks: number
}
