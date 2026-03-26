'use client'

import { useState, useEffect, useRef } from 'react'
import { useMissionControl } from '@/store'

interface CommandEntry {
  id: string
  agent_name: string
  command: string
  sent_at: number
  response?: string
  status: 'sent' | 'delivered' | 'failed'
}

export interface ChatBridgePanelProps {
  className?: string
}

function formatTs(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function ChatBridgePanel({ className }: ChatBridgePanelProps) {
  const agents = useMissionControl(s => s.agents)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<CommandEntry[]>([])
  const [isSending, setIsSending] = useState(false)
  const historyEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const visibleAgents = agents.filter(a => a.status !== 'offline')

  // Auto-scroll to bottom when history grows
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history.length])

  const handleSend = async () => {
    if (!selectedAgent || !command.trim()) return

    const entry: CommandEntry = {
      id: `cmd_${Date.now()}`,
      agent_name: selectedAgent,
      command: command.trim(),
      sent_at: Date.now(),
      status: 'sent',
    }

    setHistory(prev => [...prev, entry])
    setCommand('')
    setIsSending(true)

    try {
      const lower = command.trim().toLowerCase()
      if (['start', 'stop', 'restart', 'halt'].includes(lower)) {
        const agent = agents.find(a => a.name === selectedAgent)
        if (agent) {
          await fetch(`/api/agents/${agent.id}/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: lower === 'halt' ? 'stop' : lower }),
          })
        }
        setHistory(prev =>
          prev.map(e => e.id === entry.id ? { ...e, status: 'delivered' as const } : e)
        )
      } else {
        await fetch('/api/chat/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: command.trim(),
            recipient: selectedAgent,
            type: 'command',
          }),
        })
        setHistory(prev =>
          prev.map(e => e.id === entry.id ? { ...e, status: 'delivered' as const } : e)
        )
      }
    } catch {
      setHistory(prev =>
        prev.map(e => e.id === entry.id ? { ...e, status: 'failed' as const } : e)
      )
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div
      className={`flex flex-col h-full bg-[var(--surface)] text-[var(--text-primary)]${className ? ` ${className}` : ''}`}
    >
      {/* Header */}
      <div className="flex items-center px-4 py-2 border-b border-[var(--border)] flex-shrink-0">
        <span className="text-sm font-medium text-[var(--text-primary)]">Agent Command Bridge</span>
      </div>

      {/* Agent selector */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-[var(--border)] flex-shrink-0 overflow-x-auto">
        {visibleAgents.length === 0 ? (
          <span className="text-xs font-mono text-[var(--text-muted)]">No agents online</span>
        ) : (
          visibleAgents.map(agent => {
            const isSelected = selectedAgent === agent.name
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => setSelectedAgent(isSelected ? null : agent.name)}
                className={[
                  'inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border transition-colors whitespace-nowrap cursor-pointer',
                  isSelected
                    ? 'border-[#3b82f6] text-[#3b82f6] bg-[rgba(59,130,246,0.10)]'
                    : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[#3b82f6] hover:text-[#3b82f6]',
                ].join(' ')}
              >
                {agent.name}
              </button>
            )
          })
        )}
      </div>

      {/* Command history */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-2">
        {history.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs font-mono text-[var(--text-muted)] text-center">
              No commands sent yet. Select an agent and type a command.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {history.map(entry => (
              <div key={entry.id} className="flex items-start gap-2 py-0.5">
                {/* Status dot */}
                <span
                  className="mt-[3px] w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor:
                      entry.status === 'delivered'
                        ? '#22c55e'
                        : entry.status === 'failed'
                          ? '#ef4444'
                          : '#f59e0b',
                  }}
                  title={entry.status}
                />
                {/* Agent name */}
                <span className="text-xs font-mono text-[var(--text-muted)] flex-shrink-0">
                  {entry.agent_name}
                </span>
                {/* Command text */}
                <span className="text-sm font-mono text-[var(--text-primary)] flex-1 break-all min-w-0">
                  {entry.command}
                </span>
                {/* Timestamp */}
                <span className="text-xs font-mono text-[var(--text-muted)] flex-shrink-0 tabular-nums">
                  {formatTs(entry.sent_at)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div ref={historyEndRef} />
      </div>

      {/* Command input bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-t border-[var(--border)] flex-shrink-0">
        {/* Selected agent badge */}
        <span className="text-xs font-mono text-[var(--text-muted)] flex-shrink-0">
          {selectedAgent ? (
            <span className="text-[#3b82f6]">{selectedAgent}</span>
          ) : (
            'Select agent'
          )}
        </span>

        {/* Divider */}
        <span className="text-[var(--border)] flex-shrink-0 select-none">|</span>

        {/* Text input */}
        <input
          ref={inputRef}
          type="text"
          value={command}
          onChange={e => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          disabled={isSending}
          className="flex-1 text-sm font-mono bg-transparent border-none outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)] disabled:opacity-50"
        />

        {/* Send button */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!selectedAgent || !command.trim() || isSending}
          className="text-xs font-mono text-[#3b82f6] hover:text-[#60a5fa] disabled:text-[var(--text-muted)] disabled:cursor-not-allowed transition-colors flex-shrink-0 cursor-pointer"
        >
          {isSending ? '...' : 'Send'}
        </button>
      </div>
    </div>
  )
}

export default ChatBridgePanel
