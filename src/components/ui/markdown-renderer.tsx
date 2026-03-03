'use client'

import ReactMarkdown from 'react-markdown'

interface MarkdownRendererProps {
  content: string
  className?: string
  compact?: boolean
}

/**
 * Renders markdown content with styled HTML output.
 * Uses react-markdown for safe rendering (no dangerouslySetInnerHTML).
 *
 * @param content  - Raw markdown string
 * @param className - Additional CSS classes for the wrapper
 * @param compact  - If true, uses tighter spacing for card previews
 */
export function MarkdownRenderer({ content, className = '', compact = false }: MarkdownRendererProps) {
  return (
    <div className={`markdown-body ${compact ? 'markdown-compact' : ''} ${className}`}>
    <ReactMarkdown
      components={{
        h1: ({ children }) => <h1 className="text-lg font-bold text-foreground mt-4 mb-2 first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-semibold text-foreground mt-3 mb-1.5 first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold text-foreground mt-2 mb-1 first:mt-0">{children}</h3>,
        p: ({ children }) => <p className="text-foreground/80 mb-2 last:mb-0 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-0.5 text-foreground/80">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-0.5 text-foreground/80">{children}</ol>,
        li: ({ children }) => <li className="text-foreground/80">{children}</li>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {children}
          </a>
        ),
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        code: ({ children, className: codeClassName }) => {
          const isBlock = codeClassName?.includes('language-')
          if (isBlock) {
            return (
              <code className="block bg-secondary/60 rounded-md px-3 py-2 text-xs font-mono text-foreground/90 overflow-x-auto mb-2">
                {children}
              </code>
            )
          }
          return (
            <code className="bg-secondary/60 rounded px-1 py-0.5 text-xs font-mono text-foreground/90">
              {children}
            </code>
          )
        },
        pre: ({ children }) => <pre className="mb-2 last:mb-0">{children}</pre>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-primary/40 pl-3 my-2 text-foreground/60 italic">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="border-border my-3" />,
        table: ({ children }) => (
          <div className="overflow-x-auto mb-2">
            <table className="w-full text-sm border-collapse">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="text-left px-2 py-1 border-b border-border text-foreground font-medium">{children}</th>,
        td: ({ children }) => <td className="px-2 py-1 border-b border-border/40 text-foreground/80">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
    </div>
  )
}
