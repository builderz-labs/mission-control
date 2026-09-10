import type { ReactNode } from 'react'

export function renderSessionContent(text: string): ReactNode[] {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const inner = part.slice(3, -3)
      const newlineIdx = inner.indexOf('\n')
      const lang = newlineIdx > 0 ? inner.slice(0, newlineIdx).trim() : ''
      const code = newlineIdx > 0 ? inner.slice(newlineIdx + 1) : inner
      return (
        <div key={i} className="my-1.5 overflow-hidden rounded border border-border/30">
          {lang ? (
            <div className="border-b border-border/20 bg-black/30 px-2 py-0.5 text-[10px] text-muted-foreground/50">
              {lang}
            </div>
          ) : null}
          <pre className="overflow-x-auto whitespace-pre bg-black/20 px-3 py-2 text-[11px]">{code}</pre>
        </div>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="rounded bg-black/20 px-1 py-0.5 text-[11px]">{part.slice(1, -1)}</code>
    }
    return <span key={i}>{renderInlineFormatting(part)}</span>
  })
}

function renderInlineFormatting(text: string): ReactNode[] {
  const lines = text.split('\n')
  const result: ReactNode[] = []
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) result.push('\n')
    const line = lines[i]
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/)
    if (headerMatch) {
      const level = headerMatch[1].length
      const headerClass = level === 1 ? 'text-sm font-bold' : level === 2 ? 'text-xs font-semibold' : 'text-xs font-medium'
      result.push(<span key={`h-${i}`} className={`${headerClass} text-foreground`}>{renderInlineText(headerMatch[2])}</span>)
      continue
    }
    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)/)
    if (listMatch) {
      const bullet = listMatch[2].match(/\d/) ? listMatch[2] : '\u2022'
      result.push(
        <span key={`li-${i}`} style={{ paddingLeft: `${listMatch[1].length * 4 + 4}px` }}>
          <span className="text-muted-foreground/50">{bullet}</span> {renderInlineText(listMatch[3])}
        </span>,
      )
      continue
    }
    result.push(<span key={`l-${i}`}>{renderInlineText(line)}</span>)
  }
  return result
}

function renderInlineText(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g)
  return parts.map((segment, j) => {
    if (segment.startsWith('**') && segment.endsWith('**')) {
      return <strong key={j} className="font-semibold text-foreground">{segment.slice(2, -2)}</strong>
    }
    if (segment.startsWith('*') && segment.endsWith('*') && !segment.startsWith('**')) {
      return <em key={j}>{segment.slice(1, -1)}</em>
    }
    const linkMatch = segment.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      return (
        <a key={j} href={linkMatch[2]} target="_blank" rel="noopener noreferrer"
          className="text-primary/80 underline decoration-primary/30 hover:decoration-primary/60">
          {linkMatch[1]}
        </a>
      )
    }
    return segment
  })
}
