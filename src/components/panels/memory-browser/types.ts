// Import and re-export MemoryFile so callers have a single source of truth
import type { MemoryFile } from '@/store/slices/log-slice'
export type { MemoryFile }

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

export type ActiveView = 'files' | 'graph' | 'health' | 'pipeline' | 'hermes'
export type FileFilter = 'all' | 'daily' | 'knowledge'
export interface SearchResultItem { path: string; name: string; matches: number }

export interface UseMemoryBrowserReturn {
  // Derived from store (not local state)
  selectedMemoryFile: string
  memoryContent: string | null
  // Local state
  isLoading: boolean
  error: string | null
  expandedFolders: Set<string>
  searchResults: SearchResultItem[]
  searchQuery: string
  isSearching: boolean
  isEditing: boolean
  editedContent: string
  showCreateModal: boolean
  showDeleteConfirm: boolean
  isSaving: boolean
  activeView: ActiveView
  hermesMemory: HermesMemoryData | null
  hermesInstalled: boolean | null
  isLoadingHermes: boolean
  sidebarOpen: boolean
  fileFilter: FileFilter
  schemaWarnings: string[]
  linksOpen: boolean
  healthReport: HealthReport | null
  isLoadingHealth: boolean
  pipelineResult: ProcessingResult | null
  mocGroups: MOCGroup[]
  isRunningPipeline: boolean
  isHydratingTree: boolean
  // Derived
  filteredFiles: MemoryFile[]
  fileCount: number
  sizeTotal: number
  typedFileLinks: FileLinks | null
  // State setters
  setError: (error: string | null) => void
  setSearchQuery: (query: string) => void
  setIsEditing: (editing: boolean) => void
  setEditedContent: (content: string) => void
  setShowCreateModal: (show: boolean) => void
  setShowDeleteConfirm: (show: boolean) => void
  setSidebarOpen: (open: boolean) => void
  setFileFilter: (filter: FileFilter) => void
  setLinksOpen: (open: boolean) => void
  setActiveView: (view: ActiveView) => void
  setSearchResults: (results: SearchResultItem[]) => void
  // Async actions
  loadFileTree: () => Promise<void>
  loadFileContent: (filePath: string) => Promise<void>
  searchFiles: () => Promise<void>
  toggleFolder: (folderPath: string, needsChildren: boolean) => Promise<void>
  saveFile: () => Promise<void>
  createNewFile: (filePath: string, content?: string) => Promise<void>
  deleteFile: () => Promise<void>
  loadHealth: () => Promise<void>
  runPipelineAction: (action: string) => Promise<void>
  navigateToWikiLink: (target: string) => void
  // Composite actions
  closeFile: () => void
  refreshHermes: () => void
}
