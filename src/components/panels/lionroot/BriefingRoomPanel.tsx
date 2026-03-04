'use client'

/**
 * Briefing Room Panel — Browse and discuss agent research outputs.
 *
 * Phase 1: Read-only document browser with markdown rendering.
 * Phase 2 (future): Threaded discussions via content-sync v2.
 */

import { useState, useEffect, useCallback } from 'react'
import { useMissionControl } from '@/store'

/* ── Types ── */

interface AgentSummary {
  id: string
  outputCount: number
  totalSize: number
  latestOutput?: number
  readCount: number
  unreadCount: number
}

interface OutputFile {
  name: string
  size: number
  modified: number
  read: boolean
  readAt: number | null
}

/* ── Agent emoji/label map ── */

const AGENT_META: Record<string, { emoji: string; label: string }> = {
  leo: { emoji: '🦁', label: 'Leo' },
  cody: { emoji: '💻', label: 'Cody' },
  artie: { emoji: '🎨', label: 'Artie' },
  exdi: { emoji: '📊', label: 'Exdi' },
  grove: { emoji: '🌿', label: 'Grove' },
  finn: { emoji: '💰', label: 'Finn' },
  nesta: { emoji: '🏠', label: 'Nesta' },
  archie: { emoji: '🏗️', label: 'Archie' },
  liev: { emoji: '🍳', label: 'Liev' },
  mako: { emoji: '🔧', label: 'Mako' },
  projel: { emoji: '📋', label: 'Projel' },
  clawdy: { emoji: '🦞', label: 'Clawdy' },
  schoolie: { emoji: '📚', label: 'Schoolie' },
}

function agentLabel(id: string): string {
  return AGENT_META[id]?.label || id.charAt(0).toUpperCase() + id.slice(1)
}
function agentEmoji(id: string): string {
  return AGENT_META[id]?.emoji || '🤖'
}

/* ── Helpers ── */

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return (bytes / 1_000_000).toFixed(1) + ' MB'
  if (bytes >= 1_000) return (bytes / 1_000).toFixed(1) + ' KB'
  return bytes + ' B'
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  const hours = diff / 3_600_000
  if (hours < 1) return 'just now'
  if (hours < 24) return Math.floor(hours) + 'h ago'
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return days + 'd ago'
  return formatDate(ts)
}

/** Parse title from markdown heading or filename */
function parseTitle(filename: string, content?: string): string {
  if (content) {
    const lines = content.split('\n')
    for (const line of lines) {
      const match = line.match(/^#+\s+(.+)/)
      if (match) return match[1].trim()
    }
  }
  // Fallback: prettify filename
  return filename
    .replace(/\.md$|\.txt$/, '')
    .replace(/^research-\d{4}-\d{2}-\d{2}-/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

/* ── Simple markdown renderer ── */

function MarkdownContent({ content }: { content: string }) {
  // Convert markdown to HTML (basic but covers common patterns)
  const html = content
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-secondary rounded-md p-3 my-3 overflow-x-auto text-xs"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-secondary px-1 py-0.5 rounded text-xs">$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-5 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold mt-6 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-6 mb-3">$1</h1>')
    // Bold / italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary underline" target="_blank" rel="noopener">$1</a>')
    // Bullet lists
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // Numbered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-2 border-border pl-3 my-2 text-muted-foreground">$1</blockquote>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr class="my-4 border-border" />')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p class="my-2">')

  return (
    <div
      className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: `<p class="my-2">${html}</p>` }}
    />
  )
}

/* ── Main Panel ── */

export function BriefingRoomPanel() {
  const { setChatPanelOpen, setActiveConversation, setChatInput } = useMissionControl()

  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [files, setFiles] = useState<OutputFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ agent: string; file: string; matches: number }> | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Load agents ──
  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/lionroot/briefing-room?action=agents')
      if (!res.ok) throw new Error('Failed to load agents')
      const data = await res.json()
      setAgents(data.agents || [])
    } catch (err) {
      setError('Could not load agent list')
    }
  }, [])

  useEffect(() => { loadAgents() }, [loadAgents])

  // ── Load outputs for agent ──
  const selectAgent = useCallback(async (agentId: string) => {
    setSelectedAgent(agentId)
    setSelectedFile(null)
    setFileContent('')
    setSearchResults(null)
    setIsLoading(true)
    try {
      const res = await fetch(`/api/lionroot/briefing-room?action=outputs&agent=${encodeURIComponent(agentId)}`)
      if (!res.ok) throw new Error('Failed to load outputs')
      const data = await res.json()
      setFiles(data.files || [])
    } catch (err) {
      setError('Could not load outputs')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // ── Read file content ──
  const selectFile = useCallback(async (agentId: string, fileName: string) => {
    setSelectedFile(fileName)
    setIsLoading(true)
    try {
      const res = await fetch(
        `/api/lionroot/briefing-room?action=read&agent=${encodeURIComponent(agentId)}&file=${encodeURIComponent(fileName)}`
      )
      if (!res.ok) throw new Error('Failed to read file')
      const data = await res.json()
      setFileContent(data.content || '')
    } catch (err) {
      setError('Could not read file')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // ── Mark read/unread ──
  const toggleRead = useCallback(async (agentId: string, fileName: string, isRead: boolean) => {
    const action = isRead ? 'mark-unread' : 'mark-read'
    await fetch('/api/lionroot/briefing-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, agent: agentId, file: fileName }),
    })
    // Refresh file list
    if (selectedAgent === agentId) {
      const res = await fetch(`/api/lionroot/briefing-room?action=outputs&agent=${encodeURIComponent(agentId)}`)
      if (res.ok) {
        const data = await res.json()
        setFiles(data.files || [])
      }
    }
    loadAgents() // Refresh counts
  }, [selectedAgent, loadAgents])

  // ── Search ──
  const doSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null)
      return
    }
    setIsLoading(true)
    try {
      const res = await fetch(`/api/lionroot/briefing-room?action=search&query=${encodeURIComponent(searchQuery)}`)
      if (!res.ok) throw new Error('Search failed')
      const data = await res.json()
      setSearchResults(data.results || [])
      setSelectedAgent(null)
      setSelectedFile(null)
      setFileContent('')
    } catch (err) {
      setError('Search failed')
    } finally {
      setIsLoading(false)
    }
  }, [searchQuery])

  // ── Discuss with agent ──
  const discussWithAgent = (agentId: string, fileName: string) => {
    const name = agentLabel(agentId)
    const title = parseTitle(fileName, fileContent)
    // Open chat panel with the agent's conversation and pre-fill context
    setActiveConversation(`agent_${name}`)
    setChatInput(`I'd like to discuss your output: **${title}** (${fileName})\n\n`)
    setChatPanelOpen(true)
  }

  // ── Total unread count ──
  const totalUnread = agents.reduce((s, a) => s + a.unreadCount, 0)

  return (
    <div className="flex h-full">
      {/* ── Left sidebar: agents + search ── */}
      <div className="w-56 border-r border-border flex flex-col bg-card/50 shrink-0">
        <div className="p-3 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <path d="M5 5h6M5 8h4M5 11h5" />
            </svg>
            Briefing Room
            {totalUnread > 0 && (
              <span className="ml-auto text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                {totalUnread}
              </span>
            )}
          </h2>
        </div>

        {/* Search */}
        <div className="p-2 border-b border-border">
          <div className="flex gap-1">
            <input
              type="text"
              placeholder="Search outputs..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch()}
              className="flex-1 text-xs px-2 py-1.5 rounded bg-secondary border border-border focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={doSearch}
              className="px-2 py-1.5 text-xs rounded bg-secondary hover:bg-secondary/80 border border-border"
            >
              🔍
            </button>
          </div>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto">
          {agents.length === 0 && !isLoading && (
            <p className="text-xs text-muted-foreground p-3">No agent outputs found</p>
          )}
          {agents.map(agent => (
            <button
              key={agent.id}
              onClick={() => selectAgent(agent.id)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-secondary/60 transition-colors ${
                selectedAgent === agent.id ? 'bg-secondary' : ''
              }`}
            >
              <span className="text-base">{agentEmoji(agent.id)}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{agentLabel(agent.id)}</div>
                <div className="text-xs text-muted-foreground">
                  {agent.latestOutput ? formatRelative(agent.latestOutput) : ''}
                </div>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-xs text-muted-foreground">{agent.outputCount}</span>
                {agent.unreadCount > 0 && (
                  <span className="text-[10px] bg-primary text-primary-foreground px-1 rounded-full">
                    {agent.unreadCount}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Middle: file list ── */}
      {(selectedAgent || searchResults) && (
        <div className="w-64 border-r border-border flex flex-col bg-card/30 shrink-0">
          <div className="p-3 border-b border-border">
            <h3 className="text-sm font-semibold">
              {searchResults
                ? `Search: "${searchQuery}" (${searchResults.length})`
                : `${agentEmoji(selectedAgent!)} ${agentLabel(selectedAgent!)} — Outputs`
              }
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {searchResults ? (
              searchResults.map((r, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setSelectedAgent(r.agent)
                    selectFile(r.agent, r.file)
                    setSearchResults(null)
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-secondary/60 border-b border-border/50"
                >
                  <div className="text-xs text-muted-foreground">{agentEmoji(r.agent)} {agentLabel(r.agent)}</div>
                  <div className="text-sm truncate">{parseTitle(r.file)}</div>
                  <div className="text-xs text-muted-foreground">{r.matches} match{r.matches !== 1 ? 'es' : ''}</div>
                </button>
              ))
            ) : (
              files.map(file => (
                <button
                  key={file.name}
                  onClick={() => selectFile(selectedAgent!, file.name)}
                  className={`w-full text-left px-3 py-2 hover:bg-secondary/60 border-b border-border/50 ${
                    selectedFile === file.name ? 'bg-secondary' : ''
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {!file.read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    )}
                    <span className={`text-sm truncate ${file.read ? 'text-muted-foreground' : 'font-medium'}`}>
                      {parseTitle(file.name)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(file.modified)} · {formatSize(file.size)}
                  </div>
                </button>
              ))
            )}
            {!searchResults && files.length === 0 && !isLoading && (
              <p className="text-xs text-muted-foreground p-3">No output files</p>
            )}
          </div>
        </div>
      )}

      {/* ── Right: content viewer ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedFile && selectedAgent ? (
          <>
            {/* Header */}
            <div className="p-4 border-b border-border flex items-center gap-3">
              <span className="text-xl">{agentEmoji(selectedAgent)}</span>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold truncate">
                  {parseTitle(selectedFile, fileContent)}
                </h2>
                <div className="text-xs text-muted-foreground">
                  {agentLabel(selectedAgent)} · {selectedFile}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => discussWithAgent(selectedAgent, selectedFile)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  💬 Discuss with {agentLabel(selectedAgent)}
                </button>
                <button
                  onClick={() => {
                    const file = files.find(f => f.name === selectedFile)
                    if (file) toggleRead(selectedAgent, selectedFile, file.read)
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                    files.find(f => f.name === selectedFile)?.read
                      ? 'border-border text-muted-foreground hover:bg-secondary'
                      : 'border-primary/50 text-primary hover:bg-primary/10'
                  }`}
                >
                  {files.find(f => f.name === selectedFile)?.read ? '↩ Mark Unread' : '✅ Mark Read'}
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  Loading...
                </div>
              ) : (
                <MarkdownContent content={fileContent} />
              )}
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-sm font-medium">Select an agent to browse their outputs</p>
              <p className="text-xs mt-1">Research papers, PRDs, maintenance reports</p>
              {totalUnread > 0 && (
                <p className="text-xs mt-3 text-primary">{totalUnread} unread document{totalUnread !== 1 ? 's' : ''}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-destructive text-destructive-foreground px-4 py-2 rounded-md text-sm shadow-lg z-50">
          {error}
          <button onClick={() => setError(null)} className="ml-3 underline">dismiss</button>
        </div>
      )}
    </div>
  )
}
