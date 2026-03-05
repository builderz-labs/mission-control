'use client'

import { useEffect, useMemo } from 'react'
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'

import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import './block-editor.css'

interface BlockEditorProps {
  /** Initial markdown content (converted to blocks on mount) */
  initialMarkdown?: string
  /** Called with markdown string on every change */
  onChange?: (markdown: string) => void
  /** Called when editor loses focus */
  onBlur?: (markdown: string) => void
  /** Placeholder text */
  placeholder?: string
  /** Make editor read-only */
  editable?: boolean
  /** Auto-focus on mount */
  autoFocus?: boolean
  /** Compact mode — smaller padding, no side menu */
  compact?: boolean
}

export function BlockEditor({
  initialMarkdown = '',
  onChange,
  onBlur,
  placeholder = 'Add a description...',
  editable = true,
  autoFocus = false,
  compact = false,
}: BlockEditorProps) {
  // Parse initial markdown to blocks (memoized to avoid re-parsing)
  const initialContent = useMemo(() => {
    if (!initialMarkdown.trim()) return undefined
    // We'll set this after editor creation via replaceBlocks
    return undefined
  }, []) // intentionally empty — we handle initial content in useEffect

  const editor = useCreateBlockNote({
    initialContent,
    domAttributes: {
      editor: {
        class: compact ? 'bn-compact' : '',
      },
    },
  })

  // Load initial markdown content
  useEffect(() => {
    if (initialMarkdown.trim()) {
      const loadContent = async () => {
        try {
          const blocks = await editor.tryParseMarkdownToBlocks(initialMarkdown)
          editor.replaceBlocks(editor.document, blocks)
        } catch {
          // If markdown parsing fails, just leave default empty block
        }
      }
      loadContent()
    }
  }, []) // Run once on mount

  // Handle editable changes
  useEffect(() => {
    editor.isEditable = editable
  }, [editor, editable])

  // Auto-focus
  useEffect(() => {
    if (autoFocus && editable) {
      // Small delay to ensure DOM is ready
      const t = setTimeout(() => editor.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [autoFocus, editable, editor])

  const getMarkdown = async () => {
    return await editor.blocksToMarkdownLossy(editor.document)
  }

  return (
    <div
      className="block-editor-wrapper"
      onBlur={async (e) => {
        // Only fire onBlur when focus leaves the entire editor wrapper
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          if (onBlur) {
            const md = await getMarkdown()
            onBlur(md)
          }
        }
      }}
    >
      <BlockNoteView
        editor={editor}
        theme="dark"
        onChange={async () => {
          if (onChange) {
            const md = await getMarkdown()
            onChange(md)
          }
        }}
        data-placeholder={placeholder}
      />
    </div>
  )
}
