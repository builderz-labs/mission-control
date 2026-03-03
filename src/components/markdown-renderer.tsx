'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownRendererProps {
  content: string
  preview?: boolean
}

function getPreviewContent(content: string): string {
  const firstParagraph = content.trim().split(/\n\s*\n/)[0] || ''
  if (firstParagraph.length <= 240) return firstParagraph
  return `${firstParagraph.slice(0, 240)}...`
}

export function MarkdownRenderer({ content, preview = false }: MarkdownRendererProps) {
  if (!content?.trim()) return null

  const markdownContent = preview ? getPreviewContent(content) : content

  return (
    <div className={`prose prose-invert max-w-none ${preview ? 'text-xs' : 'text-sm'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className={`${preview ? 'text-sm' : 'text-xl'} font-semibold mb-2`}>{children}</h1>,
          h2: ({ children }) => <h2 className={`${preview ? 'text-xs' : 'text-lg'} font-semibold mb-2`}>{children}</h2>,
          h3: ({ children }) => <h3 className={`${preview ? 'text-xs' : 'text-base'} font-semibold mb-1`}>{children}</h3>,
          p: ({ children }) => <p className={`text-foreground/85 ${preview ? 'text-xs mb-1' : 'text-sm mb-2'} leading-relaxed`}>{children}</p>,
          ul: ({ children }) => <ul className={`list-disc ml-4 ${preview ? 'text-xs mb-1' : 'text-sm mb-2'}`}>{children}</ul>,
          ol: ({ children }) => <ol className={`list-decimal ml-4 ${preview ? 'text-xs mb-1' : 'text-sm mb-2'}`}>{children}</ol>,
          li: ({ children }) => <li className="mb-0.5 text-foreground/85">{children}</li>,
          code: ({ children, className }) => {
            const isInline = !className
            if (isInline) {
              return <code className="bg-surface-2 text-primary px-1 py-0.5 rounded text-[0.85em]">{children}</code>
            }
            return (
              <code className="block bg-surface-2 border border-border rounded p-2 overflow-x-auto text-[0.85em]">
                {children}
              </code>
            )
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 italic text-muted-foreground mb-2">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
        }}
      >
        {markdownContent}
      </ReactMarkdown>
    </div>
  )
}

