'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { Agent, HeartbeatResponse } from './agent-detail-types'

interface OverviewTabProps {
  agent: Agent
  editing: boolean
  formData: any
  setFormData: (data: any) => void
  onSave: () => Promise<void>
  saveBusy?: boolean
  onStatusUpdate: (name: string, status: Agent['status'], activity?: string) => Promise<void>
  onWakeAgent: (name: string, sessionKey: string) => Promise<void>
  onEdit: () => void
  onCancel: () => void
  heartbeatData: HeartbeatResponse | null
  loadingHeartbeat: boolean
  onPerformHeartbeat: () => Promise<void>
}

export function OverviewTab({
  agent,
  editing,
  formData,
  setFormData,
  onSave,
  saveBusy,
  onStatusUpdate,
  onWakeAgent,
  onEdit,
  onCancel,
  heartbeatData,
  loadingHeartbeat,
  onPerformHeartbeat
}: OverviewTabProps) {
  const t = useTranslations('agentDetail')
  const [messageFrom, setMessageFrom] = useState('system')
  const [directMessage, setDirectMessage] = useState('')
  const [messageStatus, setMessageStatus] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<Array<{ alias: string; description?: string }>>([])
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Clear pending timer on unmount to prevent setState on unmounted component
  useEffect(() => () => { if (messageTimerRef.current) clearTimeout(messageTimerRef.current) }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/status?action=models', { signal: controller.signal })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.models) setAvailableModels(data.models)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!directMessage.trim()) return
    try {
      setMessageStatus(null)
      const response = await fetch('/api/agents/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: messageFrom || 'system',
          to: agent.name,
          message: directMessage
        }),
        signal: AbortSignal.timeout(8000)
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to send message')
      setDirectMessage('')
      setMessageStatus(t('messageSent'))
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current)
      messageTimerRef.current = setTimeout(() => setMessageStatus(null), 2000)
    } catch {
      setMessageStatus(t('messageFailed'))
    }
  }

  return (
    <div className="p-5">
      <div className="grid md:grid-cols-[1fr_1fr] gap-5">
        {/* Left Column — Agent Details */}
        <div className="space-y-4">
          {/* Status + Actions row */}
          <div className="flex items-center gap-2">
            {(['idle', 'busy', 'offline'] as const).map(status => (
              <button
                key={status}
                onClick={() => onStatusUpdate(agent.name, status)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  agent.status === status
                    ? status === 'idle' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : status === 'busy' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-slate-500/20 text-slate-300 border-slate-500/40'
                    : 'bg-transparent text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground'
                }`}
              >
                {status}
              </button>
            ))}
            {agent.session_key && (
              <button
                onClick={() => onWakeAgent(agent.name, agent.session_key!)}
                className="ml-auto px-3 py-1 text-xs rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition-colors"
              >
                Wake
              </button>
            )}
            <button
              onClick={onPerformHeartbeat}
              disabled={loadingHeartbeat}
              className="px-3 py-1 text-xs rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50 ml-auto"
              style={agent.session_key ? { marginLeft: 0 } : undefined}
            >
              {loadingHeartbeat ? '...' : t('heartbeat')}
            </button>
          </div>

          {heartbeatData && (
            <div className="text-xs text-muted-foreground bg-surface-1/30 rounded px-3 py-2">
              <span className={heartbeatData.status === 'HEARTBEAT_OK' ? 'text-green-400' : 'text-yellow-400'}>
                {heartbeatData.status}
              </span>
              {heartbeatData.total_items ? ` · ${t('workItems', { count: heartbeatData.total_items })}` : ''}
              {heartbeatData.message && ` · ${heartbeatData.message}`}
            </div>
          )}

          {/* Key fields */}
          <div className="space-y-3">
            <div className="grid grid-cols-[100px_1fr] gap-2 items-center text-sm">
              <span className="text-muted-foreground">{t('role')}</span>
              {editing ? (
                <input
                  type="text"
                  value={formData.role}
                  onChange={(e) => setFormData((prev: any) => ({ ...prev, role: e.target.value }))}
                  className="bg-surface-1 text-foreground border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              ) : (
                <span className="text-foreground">{agent.role}</span>
              )}
            </div>

            <div className="grid grid-cols-[100px_1fr] gap-2 items-center text-sm">
              <span className="text-muted-foreground">{t('model')}</span>
              {editing ? (
                <select
                  value={formData.model || ''}
                  onChange={(e) => setFormData((prev: any) => ({ ...prev, model: e.target.value }))}
                  className="bg-surface-1 text-foreground border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="">{t('default')}</option>
                  {availableModels.map((m) => (
                    <option key={m.alias} value={m.alias}>{m.alias}</option>
                  ))}
                </select>
              ) : (
                <span className="text-foreground font-mono text-xs">
                  {(() => { const p = (agent as any).config?.model?.primary; const m = (agent as any).model; const v = typeof p === 'string' ? p : p?.primary; return v || (typeof m === 'string' ? m : m?.primary) || t('default') })()}
                </span>
              )}
            </div>

            <div className="grid grid-cols-[100px_1fr] gap-2 items-center text-sm">
              <span className="text-muted-foreground">{t('sessionKey')}</span>
              {editing ? (
                <input
                  type="text"
                  value={formData.session_key}
                  onChange={(e) => setFormData((prev: any) => ({ ...prev, session_key: e.target.value }))}
                  className="bg-surface-1 text-foreground border border-border rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                  placeholder={t('sessionKeyPlaceholder')}
                />
              ) : (
                <span className="text-foreground font-mono text-xs">
                  {agent.session_key || <span className="text-muted-foreground/50">{t('notSet')}</span>}
                </span>
              )}
            </div>

            <div className="grid grid-cols-[100px_1fr] gap-2 items-center text-sm">
              <span className="text-muted-foreground">{t('created')}</span>
              <span className="text-xs text-muted-foreground">{new Date(agent.created_at * 1000).toLocaleDateString()}</span>
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2 items-center text-sm">
              <span className="text-muted-foreground">{t('updated')}</span>
              <span className="text-xs text-muted-foreground">{new Date(agent.updated_at * 1000).toLocaleDateString()}</span>
            </div>
          </div>

          {/* Task Stats — compact row */}
          {agent.taskStats && (
            <div className="flex gap-3 pt-1">
              <div className="text-center">
                <div className="text-lg font-semibold text-foreground">{agent.taskStats.total}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('statsTotal')}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-blue-400">{agent.taskStats.assigned}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('statsAssigned')}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-yellow-400">{agent.taskStats.in_progress}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('statsActive')}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-green-400">{agent.taskStats.completed}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('statsDone')}</div>
              </div>
            </div>
          )}

          {/* Edit / Save */}
          <div className="flex gap-2 pt-1">
            {editing ? (
              <>
                <Button onClick={onSave} size="sm" disabled={saveBusy}>
                  {saveBusy ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" />
                      </svg>
                      {t('saving')}
                    </span>
                  ) : t('save')}
                </Button>
                <Button onClick={onCancel} variant="secondary" size="sm" disabled={saveBusy}>{t('cancel')}</Button>
              </>
            ) : (
              <Button onClick={onEdit} variant="secondary" size="sm">{t('edit')}</Button>
            )}
          </div>
        </div>

        {/* Right Column — Direct Message */}
        <div className="border border-border rounded-lg p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-foreground">{t('message')}</h4>
            {messageStatus && (
              <span className={`text-xs ${messageStatus === 'Sent' ? 'text-green-400' : 'text-rose-400'}`}>
                {messageStatus}
              </span>
            )}
          </div>
          <form onSubmit={handleSendMessage} className="flex flex-col flex-1 gap-2">
            <input
              type="text"
              value={messageFrom}
              onChange={(e) => setMessageFrom(e.target.value)}
              className="bg-surface-1 text-foreground rounded px-2.5 py-1.5 text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder={t('from')}
            />
            <textarea
              value={directMessage}
              onChange={(e) => setDirectMessage(e.target.value)}
              className="flex-1 min-h-[80px] bg-surface-1 text-foreground rounded px-2.5 py-2 text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
              placeholder={t('sendMessagePlaceholder', { name: agent.name })}
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={!directMessage.trim()}>
                {t('send')}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
