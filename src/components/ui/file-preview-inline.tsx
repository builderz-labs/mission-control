'use client'

import { useState, useEffect, useRef } from 'react'

interface FilePreviewInlineProps {
  path: string
  displayName: string
  extension: string
  onClose: () => void
}

interface FileReadResponse {
  content: string
  size: number
  truncated: boolean
  mimeType?: string
}

function getFileIcon(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'json': return '{}'
    case 'csv':
    case 'tsv': return '||'
    case 'md': return 'M'
    case 'log': return '>'
    case 'ts':
    case 'tsx': return 'TS'
    case 'js':
    case 'jsx': return 'JS'
    case 'py': return 'PY'
    case 'yml':
    case 'yaml': return 'YM'
    case 'toml': return 'TM'
    case 'env': return '.*'
    case 'sh': return '#!'
    default: return 'F'
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function parseCsv(content: string, delimiter: string): string[][] {
  const lines = content.split('\n').filter(l => l.trim())
  return lines.map(line => {
    const cells: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"' && (i === 0 || line[i - 1] !== '\\')) {
        inQuotes = !inQuotes
      } else if (ch === delimiter && !inQuotes) {
        cells.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    cells.push(current.trim())
    return cells
  })
}

function CsvTable({ content, delimiter }: { content: string; delimiter: string }) {
  const rows = parseCsv(content, delimiter)
  if (rows.length === 0) return <p className="text-muted-foreground text-xs p-2">Empty file</p>

  const header = rows[0]
  const body = rows.slice(1, 21) // max 20 data rows

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th
                key={i}
                className="text-left px-2 py-1 border-b border-border text-foreground font-semibold bg-surface-3 whitespace-nowrap sticky top-0"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? '' : 'bg-surface-3/40'}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-2 py-1 border-b border-border/50 text-foreground/85 whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 21 && (
        <p className="text-muted-foreground text-[10px] px-2 py-1">
          Showing 20 of {rows.length - 1} rows
        </p>
      )}
    </div>
  )
}

function TextContent({ content, maxLines }: { content: string; maxLines: number }) {
  const lines = content.split('\n').slice(0, maxLines)
  return (
    <pre className="text-xs font-mono text-foreground/85 p-2 whitespace-pre overflow-x-auto leading-relaxed">
      {lines.join('\n')}
    </pre>
  )
}

function JsonContent({ content }: { content: string }) {
  let formatted: string
  try {
    formatted = JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    formatted = content
  }
  const lines = formatted.split('\n').slice(0, 50)
  return (
    <pre className="text-xs font-mono text-foreground/85 p-2 whitespace-pre overflow-x-auto leading-relaxed">
      {lines.join('\n')}
    </pre>
  )
}

export function FilePreviewInline({ path, displayName, extension, onClose }: FilePreviewInlineProps) {
  const [data, setData] = useState<FileReadResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`)
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Failed to read file (${res.status})`)
        }
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load file')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [path])

  // Expand animation
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.style.maxHeight = '0px'
    el.style.opacity = '0'
    requestAnimationFrame(() => {
      el.style.transition = 'max-height 0.3s ease-out, opacity 0.2s ease-out'
      el.style.maxHeight = '320px'
      el.style.opacity = '1'
    })
  }, [])

  const ext = extension.toLowerCase()
  const icon = getFileIcon(ext)

  function renderContent() {
    if (loading) {
      return (
        <div className="p-3 space-y-2 animate-pulse">
          <div className="h-3 bg-surface-3 rounded w-3/4" />
          <div className="h-3 bg-surface-3 rounded w-1/2" />
          <div className="h-3 bg-surface-3 rounded w-5/6" />
          <div className="h-3 bg-surface-3 rounded w-2/3" />
        </div>
      )
    }

    if (error) {
      return (
        <div className="p-3 flex items-center gap-2 text-xs text-red-400">
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 5v3.5M8 10.5v.5" />
          </svg>
          {error}
        </div>
      )
    }

    if (!data) return null

    if (ext === 'csv') return <CsvTable content={data.content} delimiter="," />
    if (ext === 'tsv') return <CsvTable content={data.content} delimiter={'\t'} />
    if (ext === 'json') return <JsonContent content={data.content} />
    return <TextContent content={data.content} maxLines={50} />
  }

  return (
    <div
      ref={containerRef}
      className="border border-border rounded-lg bg-surface-2 overflow-hidden my-1.5"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border/50 bg-surface-3">
        <span className="text-[10px] font-mono font-bold text-primary bg-primary/10 rounded px-1 py-0.5 shrink-0">
          {icon}
        </span>
        <span className="text-xs font-medium text-foreground truncate flex-1" title={path}>
          {displayName}
        </span>
        {data && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {formatSize(data.size)}
          </span>
        )}
        {data?.truncated && (
          <span className="text-[10px] bg-yellow-500/20 text-yellow-400 rounded px-1 py-0.5 shrink-0">
            truncated
          </span>
        )}
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-smooth shrink-0 ml-1 p-0.5 rounded hover:bg-surface-2"
          aria-label="Close preview"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="overflow-y-auto" style={{ maxHeight: '260px' }}>
        {renderContent()}
      </div>
    </div>
  )
}
