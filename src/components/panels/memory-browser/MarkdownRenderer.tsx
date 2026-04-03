'use client'

import React from 'react'

// Renders inline markdown: `code`, **bold**, *italic*, [[wiki links]]
export function renderInline(
  text: string,
  onNavigate: (target: string) => void
): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const m = match[0]
    if (m.startsWith('[[') && m.endsWith(']]')) {
      const target = match[2]?.trim() || ''
      const display = (match[3] || match[2] || '').trim()
      parts.push(
        <button
          key={key++}
          onClick={() => onNavigate(target)}
          className="text-primary/80 hover:text-primary underline underline-offset-2 decoration-primary/30 hover:decoration-primary/60 transition-colors font-mono text-[12px] cursor-pointer"
          title={`Navigate to [[${target}]]`}
        >
          {display}
        </button>
      )
    } else if (m.startsWith('`') && m.endsWith('`')) {
      parts.push(<code key={key++} className="bg-[hsl(var(--surface-2))] px-1 py-0.5 rounded text-[12px] font-mono text-primary/80">{m.slice(1, -1)}</code>)
    } else if (m.startsWith('**') && m.endsWith('**')) {
      parts.push(<strong key={key++} className="font-semibold text-foreground">{m.slice(2, -2)}</strong>)
    } else if (m.startsWith('*') && m.endsWith('*')) {
      parts.push(<em key={key++}>{m.slice(1, -1)}</em>)
    }
    lastIndex = pattern.lastIndex
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

interface MarkdownRendererProps {
  content: string
  onNavigate: (target: string) => void
}

export function MarkdownRenderer({ content, onNavigate }: MarkdownRendererProps) {
  const lines = content.split('\n')
  const elements: React.ReactElement[] = []
  const seenHeaders = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.startsWith('# ')) {
      const text = trimmed.slice(2)
      const id = `h1-${text.toLowerCase().replace(/\s+/g, '-')}`
      if (seenHeaders.has(id)) continue
      seenHeaders.add(id)
      elements.push(<h1 key={i} className="text-xl font-bold mt-6 mb-2 text-foreground font-mono">{renderInline(text, onNavigate)}</h1>)
    } else if (trimmed.startsWith('## ')) {
      const text = trimmed.slice(3)
      const id = `h2-${text.toLowerCase().replace(/\s+/g, '-')}`
      if (seenHeaders.has(id)) continue
      seenHeaders.add(id)
      elements.push(<h2 key={i} className="text-lg font-semibold mt-5 mb-2 text-foreground/90 font-mono">{renderInline(text, onNavigate)}</h2>)
    } else if (trimmed.startsWith('### ')) {
      const text = trimmed.slice(4)
      const id = `h3-${text.toLowerCase().replace(/\s+/g, '-')}`
      if (seenHeaders.has(id)) continue
      seenHeaders.add(id)
      elements.push(<h3 key={i} className="text-base font-semibold mt-4 mb-1.5 text-foreground/80 font-mono">{renderInline(text, onNavigate)}</h3>)
    } else if (trimmed.startsWith('- ')) {
      elements.push(
        <li key={i} className="ml-5 mb-0.5 list-disc text-foreground/80 text-sm leading-relaxed">{renderInline(trimmed.slice(2), onNavigate)}</li>
      )
    } else if (trimmed === '') {
      elements.push(<div key={i} className="h-2" />)
    } else if (trimmed.startsWith('```')) {
      const codeLang = trimmed.slice(3)
      const codeLines: string[] = []
      let j = i + 1
      while (j < lines.length && !lines[j].trim().startsWith('```')) {
        codeLines.push(lines[j])
        j++
      }
      elements.push(
        <pre key={i} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-md px-3 py-2 my-2 text-xs font-mono overflow-x-auto">
          {codeLang && <span className="text-muted-foreground/40 text-[10px] block mb-1">{codeLang}</span>}
          <code className="text-foreground/80">{codeLines.join('\n')}</code>
        </pre>
      )
      i = j
    } else {
      elements.push(
        <p key={i} className="mb-1.5 text-sm text-foreground/80 leading-relaxed">{renderInline(trimmed, onNavigate)}</p>
      )
    }
  }

  return <>{elements}</>
}
