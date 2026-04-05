export interface KnowledgeDoc {
  id: number
  filename: string
  content_type: string
  domain: string
  tags: string
  summary: string | null
  file_size: number | null
  created_at: string
}

export type ViewMode = 'grid' | 'list'
export type SortField = 'created_at' | 'filename' | 'domain' | 'file_size'
