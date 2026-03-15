export type { MemoryFile } from '@/store/types'

export type ActiveTab = 'daily' | 'knowledge' | 'all'

export interface SearchResult {
  path: string
  name: string
  matches: number
}
