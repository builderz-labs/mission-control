// Re-export from store so callers have a single source of truth
export type { MemoryFile } from '@/store/slices/log-slice'

export interface HealthCategory {
  name: string
  status: 'healthy' | 'warning' | 'critical'
  score: number
  issues: string[]
  suggestions: string[]
}

export interface HealthReport {
  overall: 'healthy' | 'warning' | 'critical'
  overallScore: number
  categories: HealthCategory[]
  generatedAt: number
}

export interface MOCGroup {
  directory: string
  entries: { title: string; path: string; linkCount: number }[]
}

export interface ProcessingResult {
  action: string
  filesProcessed: number
  changes: string[]
  suggestions: string[]
}

export interface HermesMemoryData {
  agentMemory: string | null
  userMemory: string | null
  agentMemorySize: number
  userMemorySize: number
  agentMemoryEntries: number
  userMemoryEntries: number
}

export interface FileLinks {
  wikiLinks: { target: string; display: string; line: number }[]
  incoming: string[]
  outgoing: string[]
}
