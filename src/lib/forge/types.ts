export type ForgeDetectionStatus = 'FOUND' | 'PARTIAL' | 'MISSING'

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

export interface ForgeScanItem {
  id: string
  label: string
  status: ForgeDetectionStatus
  evidence: string[]
  notes: string
}

export interface ForgeWorkspaceScan {
  modules: ForgeScanItem[]
  assets: ForgeScanItem[]
  gaps: string[]
}

export interface ForgeOrchestratorTaskOutput {
  name: string
  summary: string
  description?: string
}

export interface ForgeOrchestratorSnapshot {
  available: boolean
  sourcePath: string
  outputPath: string
  generatedAt: string | null
  reportTitle: string
  recommendedImplementationPath: string[]
  risks: string[]
  verificationChecklist: string[]
  nextAction: string
  taskOutputs: ForgeOrchestratorTaskOutput[]
  artifactFiles: string[]
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
  registryFiles: string[]
  workspaceScan: ForgeWorkspaceScan
  orchestrator: ForgeOrchestratorSnapshot
  totalOpenTasks: number
  totalCompletedTasks: number
}
