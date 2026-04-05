'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { createClientLogger } from '@/lib/client-logger'
import { type Agent, statusColors, statusIcons } from './agent-squad-panel-types'

const log = createClientLogger('AgentDetailModal')

interface AgentDetailModalProps {
  agent: Agent
  onClose: () => void
  onUpdate: () => void
  onStatusUpdate: (name: string, status: Agent['status'], activity?: string) => Promise<void>
}

interface DetailFormData {
  role: string
  session_key: string
  soul_content: string
}

function AgentTaskStatsGrid({ taskStats, t }: {
  taskStats: NonNullable<Agent['taskStats']>
  t: ReturnType<typeof useTranslations>
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-4 gap-2">
      <div className="bg-gray-700/50 rounded p-3 text-center">
        <div className="text-lg font-semibold text-white">{taskStats.total}</div>
        <div className="text-xs text-gray-400">{t('total')}</div>
      </div>
      <div className="bg-gray-700/50 rounded p-3 text-center">
        <div className="text-lg font-semibold text-blue-400">{taskStats.assigned}</div>
        <div className="text-xs text-gray-400">{t('assigned')}</div>
      </div>
      <div className="bg-gray-700/50 rounded p-3 text-center">
        <div className="text-lg font-semibold text-yellow-400">{taskStats.in_progress}</div>
        <div className="text-xs text-gray-400">{t('inProgress')}</div>
      </div>
      <div className="bg-gray-700/50 rounded p-3 text-center">
        <div className="text-lg font-semibold text-green-400">{taskStats.completed}</div>
        <div className="text-xs text-gray-400">{t('done')}</div>
      </div>
    </div>
  )
}

function AgentEditFields({ formData, onChange, t }: {
  formData: DetailFormData
  onChange: (updated: DetailFormData) => void
  t: ReturnType<typeof useTranslations>
}): React.JSX.Element {
  const inputClass = 'w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500'
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1">{t('role')}</label>
        <input
          type="text"
          value={formData.role}
          onChange={(e) => onChange({ ...formData, role: e.target.value })}
          className={inputClass}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1">{t('sessionKey')}</label>
        <input
          type="text"
          value={formData.session_key}
          onChange={(e) => onChange({ ...formData, session_key: e.target.value })}
          className={inputClass}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1">{t('soulContent')}</label>
        <textarea
          value={formData.soul_content}
          onChange={(e) => onChange({ ...formData, soul_content: e.target.value })}
          rows={4}
          className={inputClass}
          placeholder={t('soulPlaceholder')}
        />
      </div>
    </>
  )
}

export function AgentDetailModal({
  agent,
  onClose,
  onUpdate,
  onStatusUpdate,
}: AgentDetailModalProps): React.JSX.Element {
  const t = useTranslations('agentSquad')
  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState<DetailFormData>({
    role: agent.role,
    session_key: agent.session_key ?? '',
    soul_content: agent.soul_content ?? '',
  })

  const handleSave = async (): Promise<void> => {
    try {
      const response = await fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agent.name, ...formData }),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error(t('failedToUpdate'))
      setEditing(false)
      onUpdate()
    } catch (error) {
      log.error('Failed to update agent:', error)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Modal Header */}
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-xl font-bold text-white">{agent.name}</h3>
              <p className="text-gray-400">{agent.role}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className={`w-4 h-4 rounded-full ${statusColors[agent.status]}`} />
              <span className="text-white">{agent.status}</span>
              <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-2xl">×</Button>
            </div>
          </div>

          {/* Status Controls */}
          <div className="mb-6 p-4 bg-gray-700/50 rounded-lg">
            <h4 className="text-sm font-medium text-white mb-2">{t('statusControl')}</h4>
            <div className="flex gap-2">
              {(['idle', 'busy', 'offline'] as const).map(status => (
                <Button
                  key={status}
                  onClick={() => void onStatusUpdate(agent.name, status)}
                  variant={agent.status === status ? 'default' : 'secondary'}
                  size="sm"
                >
                  <span aria-hidden="true">{statusIcons[status]}</span>
                  <span className="sr-only">{status}</span>
                  <span aria-hidden="true"> {status}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* Agent Details */}
          <div className="space-y-4">
            {editing ? (
              <AgentEditFields formData={formData} onChange={setFormData} t={t} />
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">{t('role')}</label>
                  <p className="text-white">{agent.role}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">{t('sessionKey')}</label>
                  <p className="text-white font-mono">{agent.session_key ?? t('notSet')}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">{t('soulContent')}</label>
                  <p className="text-white whitespace-pre-wrap">{agent.soul_content ?? t('notSet')}</p>
                </div>
              </>
            )}

            {agent.taskStats && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">{t('taskStatistics')}</label>
                <AgentTaskStatsGrid taskStats={agent.taskStats} t={t} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">{t('created')}:</span>
                <span className="text-white ml-2">{new Date(agent.created_at * 1000).toLocaleDateString()}</span>
              </div>
              <div>
                <span className="text-gray-400">{t('lastUpdated')}:</span>
                <span className="text-white ml-2">{new Date(agent.updated_at * 1000).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-6">
            {editing ? (
              <>
                <Button onClick={() => void handleSave()} className="flex-1">{t('saveChanges')}</Button>
                <Button onClick={() => setEditing(false)} variant="secondary" className="flex-1">{t('cancel')}</Button>
              </>
            ) : (
              <Button onClick={() => setEditing(true)} className="flex-1">{t('editAgent')}</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
