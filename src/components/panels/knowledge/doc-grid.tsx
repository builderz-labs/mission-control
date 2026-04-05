'use client'

import { Button } from '@/components/ui/button'
import { type KnowledgeDoc } from './types'
import { formatBytes, getFileColor } from './helpers'
import { IconFile, IconTrash, IconUpload } from './icons'

interface DocGridProps {
  docs: KnowledgeDoc[]
  filtered: KnowledgeDoc[]
  onDelete: (id: number) => void
  onUpload: () => void
}

export function DocGrid({ docs, filtered, onDelete, onUpload }: DocGridProps): React.JSX.Element {
  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
          <IconFile className="text-muted-foreground w-6 h-6" />
        </div>
        <h3 className="text-base font-medium text-foreground mb-1">
          {docs.length === 0 ? 'No documents yet' : 'No matching documents'}
        </h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          {docs.length === 0
            ? 'Upload documents to build your knowledge base. Drag and drop files or click Upload.'
            : 'Try adjusting your search or filters.'}
        </p>
        {docs.length === 0 && (
          <Button variant="outline" size="sm" className="mt-4" onClick={onUpload}>
            <IconUpload /> Upload Document
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {filtered.map(doc => (
        <div
          key={doc.id}
          className="group rounded-xl border border-border bg-card p-4 hover:border-[hsl(var(--void-cyan))]/20 transition-all"
        >
          <div className="flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background: `color-mix(in srgb, ${getFileColor(doc.filename)} 10%, transparent)`,
                color: getFileColor(doc.filename),
              }}
            >
              <IconFile />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground truncate">{doc.filename}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{doc.domain} &middot; {formatBytes(doc.file_size)}</div>
            </div>
            <button
              onClick={() => onDelete(doc.id)}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
            >
              <IconTrash />
            </button>
          </div>
          {doc.summary && (
            <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{doc.summary}</p>
          )}
          <div className="text-[10px] text-muted-foreground/60 mt-2">
            {new Date(doc.created_at).toLocaleDateString()}
          </div>
        </div>
      ))}
    </div>
  )
}
