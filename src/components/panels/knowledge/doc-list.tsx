'use client'

import { type KnowledgeDoc } from './types'
import { formatBytes, getFileColor } from './helpers'
import { IconFile, IconTrash } from './icons'

interface DocListProps {
  filtered: KnowledgeDoc[]
  onDelete: (id: number) => void
}

export function DocList({ filtered, onDelete }: DocListProps): React.JSX.Element {
  return (
    <div className="space-y-1">
      {filtered.map(doc => (
        <div
          key={doc.id}
          className="group flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-muted/30 transition-colors"
        >
          <div
            className="w-7 h-7 rounded flex items-center justify-center shrink-0"
            style={{ color: getFileColor(doc.filename) }}
          >
            <IconFile />
          </div>
          <div className="flex-1 min-w-0 text-sm font-medium text-foreground truncate">{doc.filename}</div>
          <span className="text-xs text-muted-foreground shrink-0">{doc.domain}</span>
          <span className="text-xs text-muted-foreground shrink-0 w-16 text-right">{formatBytes(doc.file_size)}</span>
          <span className="text-xs text-muted-foreground shrink-0 w-20 text-right">
            {new Date(doc.created_at).toLocaleDateString()}
          </span>
          <button
            onClick={() => onDelete(doc.id)}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
          >
            <IconTrash />
          </button>
        </div>
      ))}
    </div>
  )
}
