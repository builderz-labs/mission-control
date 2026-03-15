'use client'

import Image from 'next/image'
import { useRef, useEffect, useState, useCallback } from 'react'
import { useMissionControl, type ChatAttachment } from '@/store'
import { Button } from '@/components/ui/button'

interface MentionSuggestion {
  handle: string
  display: string
  type: 'user' | 'agent' | 'team' | 'special'
  role?: string
}

interface ChatInputProps {
  onSend: (content: string, attachments?: ChatAttachment[]) => void
  onAbort?: () => void
  disabled?: boolean
  agents?: Array<{ name: string; role: string }>
  isGenerating?: boolean
}

export function ChatInput({ onSend, onAbort, disabled, agents = [], isGenerating }: ChatInputProps) {
  const { chatInput, setChatInput, isSendingMessage } = useMissionControl()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showMentions, setShowMentions] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionSuggestion[]>([])
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch mention suggestions from API with debounce
  const fetchMentions = useCallback((filter: string) => {
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
    fetchTimeoutRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: '15' })
        if (filter) params.set('q', filter)
        const res = await fetch(`/api/mentions?${params}`)
        if (!res.ok) return
        const data = await res.json() as { mentions: MentionSuggestion[] }
        setMentionSuggestions(data.mentions ?? [])
      } catch {
        // Fall back to client-side agent filtering
        const filtered = agents
          .filter(a => a.name.toLowerCase().includes(filter.toLowerCase()))
          .map(a => ({ handle: a.name.toLowerCase(), display: a.name, type: 'agent' as const, role: a.role }))
        setMentionSuggestions(filtered)
      }
    }, 100)
  }, [agents])

  // Clean up timeout on unmount
  useEffect(() => {
    return () => { if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current) }
  }, [])

  const autoResize = useCallback(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'
    }
  }, [])

  useEffect(() => {
    autoResize()
  }, [chatInput, autoResize])

  // Focus textarea when panel opens
  useEffect(() => {
    if (!disabled) {
      textareaRef.current?.focus()
    }
  }, [disabled])

  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files)
    for (const file of fileArray) {
      if (file.size > 10 * 1024 * 1024) continue // Skip files > 10MB
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        setAttachments(prev => [...prev, {
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl,
        }])
      }
      reader.readAsDataURL(file)
    }
  }, [])

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files)
    }
  }, [addFiles])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    const imageItems: File[] = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile()
        if (file) imageItems.push(file)
      }
    }

    if (imageItems.length > 0) {
      e.preventDefault()
      addFiles(imageItems)
    }
  }, [addFiles])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(i => Math.min(i + 1, mentionSuggestions.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (mentionSuggestions[mentionIndex]) {
          insertMention(mentionSuggestions[mentionIndex].handle)
        }
        return
      }
      if (e.key === 'Escape') {
        setShowMentions(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setChatInput(value)

    const cursorPos = e.target.selectionStart
    const textBeforeCursor = value.slice(0, cursorPos)
    const atMatch = textBeforeCursor.match(/@([\w:.-]*)$/)

    if (atMatch) {
      const filter = atMatch[1]
      setMentionFilter(filter)
      setShowMentions(true)
      setMentionIndex(0)
      fetchMentions(filter)
    } else {
      setShowMentions(false)
    }
  }

  const insertMention = (agentName: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPos = textarea.selectionStart
    const textBeforeCursor = chatInput.slice(0, cursorPos)
    const textAfterCursor = chatInput.slice(cursorPos)
    const atIndex = textBeforeCursor.lastIndexOf('@')

    const newText = textBeforeCursor.slice(0, atIndex) + `@${agentName} ` + textAfterCursor
    setChatInput(newText)
    setShowMentions(false)

    setTimeout(() => {
      const newPos = atIndex + agentName.length + 2
      textarea.setSelectionRange(newPos, newPos)
      textarea.focus()
    }, 0)
  }

  const handleSend = () => {
    const trimmed = chatInput.trim()
    if ((!trimmed && attachments.length === 0) || disabled || isSendingMessage) return
    onSend(trimmed, attachments.length > 0 ? attachments : undefined)
    setChatInput('')
    setAttachments([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div
      className={`relative border-t border-border bg-card/80 backdrop-blur-sm p-3 flex-shrink-0 safe-area-bottom ${isDragOver ? 'ring-2 ring-primary/50 bg-primary/5' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Mention autocomplete dropdown */}
      {showMentions && mentionSuggestions.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-popover/95 backdrop-blur-lg border border-border rounded-lg shadow-xl overflow-hidden max-h-40 overflow-y-auto z-10">
          {mentionSuggestions.map((suggestion, i) => (
            <Button
              key={suggestion.handle}
              variant="ghost"
              size="sm"
              className={`w-full justify-start px-3 py-2 h-auto text-sm gap-2 rounded-none ${
                i === mentionIndex ? 'bg-accent text-accent-foreground' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                insertMention(suggestion.handle)
              }}
            >
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                suggestion.type === 'team' ? 'bg-blue-500/20 text-blue-400' :
                suggestion.type === 'special' ? 'bg-amber-500/20 text-amber-400' :
                'bg-surface-2 text-muted-foreground'
              }`}>
                {suggestion.type === 'team' ? 'T' : suggestion.type === 'special' ? '*' : suggestion.display.charAt(0).toUpperCase()}
              </div>
              <span className="font-medium text-foreground">@{suggestion.handle}</span>
              <span className="text-muted-foreground text-xs ml-auto">
                {suggestion.type === 'team' ? 'team' : suggestion.type === 'special' ? '' : suggestion.role ?? suggestion.type}
              </span>
            </Button>
          ))}
        </div>
      )}

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((att, idx) => (
            <div key={idx} className="relative group rounded-md border border-border/60 bg-surface-1 overflow-hidden">
              {att.type.startsWith('image/') ? (
                <Image
                  src={att.dataUrl}
                  alt={att.name}
                  width={64}
                  height={64}
                  unoptimized
                  className="h-16 w-16 object-cover"
                />
              ) : (
                <div className="h-16 w-16 flex flex-col items-center justify-center px-1">
                  <span className="text-lg">F</span>
                  <span className="text-[9px] text-muted-foreground truncate w-full text-center">{att.name}</span>
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-white/80 px-1 py-0.5 truncate">
                {formatFileSize(att.size)}
              </div>
              <button
                onClick={() => removeAttachment(idx)}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white/80 text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Drag overlay hint */}
      {isDragOver && (
        <div className="absolute inset-0 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary/40 rounded-lg z-20 pointer-events-none">
          <span className="text-sm text-primary font-medium">Drop files here</span>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Attach button */}
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isSendingMessage}
          variant="ghost"
          size="icon-sm"
          className="rounded-lg flex-shrink-0"
          title="Attach file"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13.5 7.5l-5.8 5.8a3.2 3.2 0 01-4.5-4.5l5.8-5.8a2.1 2.1 0 013 3l-5.8 5.7a1 1 0 01-1.4-1.4l5.1-5.2" />
          </svg>
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''
          }}
        />

        <textarea
          ref={textareaRef}
          value={chatInput}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={disabled ? 'Select a conversation...' : 'Message... (@ to mention, Enter to send)'}
          disabled={disabled || isSendingMessage}
          rows={1}
          className="flex-1 resize-none bg-surface-1 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-40 transition-all"
        />

        {/* Stop / Send button */}
        {isGenerating && onAbort ? (
          <Button
            onClick={onAbort}
            variant="ghost"
            size="icon-sm"
            className="rounded-lg flex-shrink-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
            title="Stop generation"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="3" width="10" height="10" rx="1.5" />
            </svg>
          </Button>
        ) : (
          <Button
            onClick={handleSend}
            disabled={(!chatInput.trim() && attachments.length === 0) || disabled || isSendingMessage}
            size="icon-sm"
            className="rounded-lg flex-shrink-0"
            title="Send message"
          >
            {isSendingMessage ? (
              <span className="inline-block w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2L7 9" />
                <path d="M14 2l-5 12-2-5-5-2 12-5z" />
              </svg>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
