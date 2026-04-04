export interface GammaTheme {
  id: string
  name: string
  previewUrl?: string
}

export interface Generation {
  id: string
  format: FormatType
  title: string
  status: 'generating' | 'completed' | 'failed'
  gammaUrl?: string
  exportUrl?: string
  createdAt: string
  numCards: number
  themeId?: string
}

export interface DesignAgent {
  id: string
  name: string
  handle: string
  role: string
  trigger: string
  color: string
  outputs: string[]
  phase: PhaseId
}

export type PanelTab = 'create' | 'gallery' | 'agents' | 'video'
export type FormatType = 'presentation' | 'document' | 'social' | 'webpage'
export type PhaseId = 'discovery' | 'strategy' | 'system' | 'application' | 'launch'

export interface Phase {
  id: PhaseId
  label: string
  color: string
}

export interface QuickStart {
  label: string
  prompt: string
  format: FormatType
  numCards: number
  icon: string
}

export interface CreateFormState {
  format: FormatType
  inputText: string
  numCards: number
  selectedTheme: string
  dimensions: string
  instructions: string
  exportAs: 'pdf' | 'pptx'
}
