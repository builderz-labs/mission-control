'use client'

import ReactMarkdown from 'react-markdown'
import { ReactNode } from 'react'

interface MarkdownRendererProps {
  content?: string
  className?: string
  preview?: boolean
}

/**
 * Renders markdown content with proper formatting
 * preview: if true, limits to single paragraph and truncates
 */
export function MarkdownRenderer({ content, className = '', preview = false }: MarkdownRendererProps) {
  if (!content) return null

  // Limit preview to first paragraph
  const displayContent = preview ? content.split('\n\n')[0] : content

  return (
    <div className={`markdown-content ${preview ? 'line-clamp-2 overflow-hidden' : ''} ${className}`}>
      <ReactMarkdown
        components={{
          // Headings
          h1: ({ children }) => <h1 className={`font-bold text-foreground ${preview ? 'text-sm' : 'text-lg'} mt-2 mb-1`}>{children}</h1>,
          h2: ({ children }) => <h2 className={`font-bold text-foreground ${preview ? 'text-xs' : 'text-base'} mt-2 mb-1`}>{children}</h2>,
          h3: ({ children }) => <h3 className={`font-bold text-foreground ${preview ? 'text-xs' : 'text-sm'} mt-1 mb-1`}>{children}</h3>,

          // Paragraphs
          p: ({ children }) => <p className={`text-foreground/90 ${preview ? 'mb-0 text-xs' : 'mb-2'} last:mb-0`}>{children}</p>,

          // Lists
          ul: ({ children }) => <ul className={`list-disc list-inside text-foreground/90 ${preview ? 'mb-0 space-y-0 text-xs' : 'mb-2 space-y-1'}`}>{children}</ul>,
          ol: ({ children }) => <ol className={`list-decimal list-inside text-foreground/90 ${preview ? 'mb-0 space-y-0 text-xs' : 'mb-2 space-y-1'}`}>{children}</ol>,
          li: ({ children }) => <li className={`text-foreground/90 ${preview ? 'text-xs' : ''}`}>{children}</li>,

          // Code
          code: ({ children, ...props }) => {
            const isInline = !props.className?.includes('language-')
            return isInline ? (
              <code className={`bg-surface-1 text-foreground/90 px-1.5 py-0.5 rounded font-mono border border-border/30 text-xs`}>
                {children}
              </code>
            ) : preview ? null : (
              <pre className="block bg-surface-1 text-foreground/90 p-3 rounded text-xs font-mono border border-border/30 overflow-x-auto mb-2 whitespace-pre">
                <code>{children}</code>
              </pre>
            )
          },

          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className={`border-l-4 border-primary/40 pl-3 py-1 text-foreground/70 italic ${preview ? 'mb-0 text-xs' : 'mb-2'}`}>
              {children}
            </blockquote>
          ),

          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              {children}
            </a>
          ),

          // Emphasis
          em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
          strong: ({ children }) => <strong className="font-bold text-foreground">{children}</strong>,

          // Horizontal rule
          hr: () => preview ? null : <hr className="border-border/30 my-2" />,

          // Tables (if needed)
          table: ({ children }) => preview ? null : (
            <table className="w-full text-sm border-collapse border border-border/30 my-2">
              {children}
            </table>
          ),
          thead: ({ children }) => (
            <thead className="bg-surface-1/50">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody>
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="border-b border-border/30">
              {children}
            </tr>
          ),
          td: ({ children }) => (
            <td className="px-2 py-1 border border-border/30 text-foreground/80">
              {children}
            </td>
          ),
          th: ({ children }) => (
            <th className="px-2 py-1 border border-border/30 text-foreground font-bold text-left">
              {children}
            </th>
          ),
        }}
      >
        {displayContent}
      </ReactMarkdown>
    </div>
  )
}
