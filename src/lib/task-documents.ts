export interface TaskDocumentInput {
  description?: string | null
  metadata?: Record<string, any> | null
}

export interface TaskDocumentInfo {
  hasFullDocument: boolean
  sourceFile?: string
  client?: string
  artifactType?: string
  wordCount: number
  charCount: number
}

const MARKDOWN_DOCUMENT_PATTERN = /(^|\n)#{1,3}\s+\S|(^|\n)\*\*[^*]+:\*\*/
const FULL_DOCUMENT_WORD_THRESHOLD = 100
const FULL_DOCUMENT_CHAR_THRESHOLD = 1200

export function getTaskDocumentInfo(task: TaskDocumentInput): TaskDocumentInfo {
  const description = task.description || ''
  const metadata = task.metadata || {}
  const sourceFile = typeof metadata.source_file === 'string' ? metadata.source_file : undefined
  const client = typeof metadata.client === 'string' ? metadata.client : undefined
  const artifactType = typeof metadata.artifact_type === 'string' ? metadata.artifact_type : undefined
  const words = description.trim().match(/\S+/g) || []
  const wordCount = words.length
  const charCount = description.length
  const looksLikeMarkdownDocument = MARKDOWN_DOCUMENT_PATTERN.test(description)
  const hasFullDocument = Boolean(
    sourceFile ||
    metadata.document_content ||
    (looksLikeMarkdownDocument && (wordCount >= FULL_DOCUMENT_WORD_THRESHOLD || charCount >= FULL_DOCUMENT_CHAR_THRESHOLD))
  )

  return {
    hasFullDocument,
    sourceFile,
    client,
    artifactType,
    wordCount,
    charCount,
  }
}
