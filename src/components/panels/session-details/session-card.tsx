'use client'

import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import type { Session, ModelInfo, TokenUsage, ThinkingLevel, VerboseLevel, ReasoningLevel } from './types'

const SELECT_CLASS =
  'px-2 py-1 border border-border rounded bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/50'

interface SessionCardProps {
  session: Session
  isSelected: boolean
  isExpanded: boolean
  controllingSession: string | null
  editingLabel: string | null
  labelValue: string
  confirmingDelete: string | null
  labelInputRef: React.RefObject<HTMLInputElement | null>
  modelInfo: ModelInfo
  tokenUsage: TokenUsage
  status: string
  statusColor: string
  typeIcon: string
  sessionType: string
  onSelect: () => void
  onSendAction: (
    action: string,
    key: string,
    payload: Record<string, unknown>,
    method?: 'POST' | 'DELETE'
  ) => Promise<boolean>
  onSetControlling: (key: string | null) => void
  onEditLabel: (key: string | null) => void
  onSetLabelValue: (val: string) => void
  onLabelSave: (key: string) => Promise<void>
  onSetConfirmingDelete: (key: string | null) => void
  onDeleteSession: (key: string) => Promise<void>
}

export function SessionCard({
  session,
  isSelected,
  isExpanded,
  controllingSession,
  editingLabel,
  labelValue,
  confirmingDelete,
  labelInputRef,
  modelInfo,
  tokenUsage,
  status,
  statusColor,
  typeIcon,
  sessionType,
  onSelect,
  onSendAction,
  onSetControlling,
  onEditLabel,
  onSetLabelValue,
  onLabelSave,
  onSetConfirmingDelete,
  onDeleteSession,
}: SessionCardProps): JSX.Element {
  const handleControlAction = async (
    e: React.MouseEvent,
    action: 'monitor' | 'pause' | 'terminate'
  ): Promise<void> => {
    e.stopPropagation()
    if (action === 'terminate' && !window.confirm('Are you sure you want to terminate this session?')) return
    onSetControlling(`${action}-${session.id}`)
    try {
      const res = await fetch(`/api/sessions/${session.id}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || `Failed to ${action} session`)
      }
    } catch {
      alert(`Failed to ${action} session`)
    } finally {
      onSetControlling(null)
    }
  }

  return (
    <div
      className={`bg-card border border-border rounded-lg p-6 cursor-pointer transition-all ${
        isSelected ? 'ring-2 ring-primary/50 border-primary/30' : 'hover:border-primary/20'
      }`}
      onClick={onSelect}
    >
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-3">
              <span className="text-xl">{typeIcon}</span>
              <div>
                <h3 className="font-medium text-foreground truncate">{session.key}</h3>
                <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                  <span>{sessionType}</span>
                  <span>•</span>
                  <span className={statusColor}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>
                  <span>•</span>
                  <span>{session.age}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {session.flags.map((flag, index) => (
              <span key={index} className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 rounded">
                {flag}
              </span>
            ))}
            <div className={`w-3 h-3 rounded-full ${session.active ? 'bg-green-500' : 'bg-gray-500'}`} />
          </div>
        </div>

        {/* Model + Token Usage */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted-foreground mb-1">Model</div>
            <div className="font-medium text-foreground">{modelInfo.alias}</div>
            <div className="text-xs text-muted-foreground">{modelInfo.provider}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground mb-1">Token Usage</div>
            <div className="font-medium text-foreground">{session.tokens}</div>
            <div className="w-full bg-secondary rounded-full h-2 mt-1">
              <div
                className={`h-2 rounded-full transition-all ${
                  tokenUsage.percentage > 95 ? 'bg-red-500' :
                  tokenUsage.percentage > 80 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(tokenUsage.percentage, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="pt-4 border-t border-border space-y-4">
            {/* Session Details */}
            <div>
              <h4 className="font-medium text-foreground mb-2">Session Details</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Kind:</span>
                  <span className="ml-2 text-foreground">{session.kind}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">ID:</span>
                  <span className="ml-2 text-foreground font-mono text-xs">{session.id}</span>
                </div>
                {session.lastActivity && (
                  <div>
                    <span className="text-muted-foreground">Last Activity:</span>
                    <span className="ml-2 text-foreground">
                      {new Date(session.lastActivity).toLocaleTimeString()}
                    </span>
                  </div>
                )}
                {session.messageCount && (
                  <div>
                    <span className="text-muted-foreground">Messages:</span>
                    <span className="ml-2 text-foreground">{session.messageCount}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Editable Label */}
            <div>
              <h4 className="font-medium text-foreground mb-2">Label</h4>
              {editingLabel === session.key ? (
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={labelInputRef}
                    type="text"
                    value={labelValue}
                    onChange={(e) => onSetLabelValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onLabelSave(session.key)
                      if (e.key === 'Escape') onEditLabel(null)
                    }}
                    onBlur={() => onLabelSave(session.key)}
                    maxLength={100}
                    className="flex-1 px-2 py-1 border border-border rounded bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    autoFocus
                  />
                </div>
              ) : (
                <button
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onClick={(e) => {
                    e.stopPropagation()
                    onEditLabel(session.key)
                    onSetLabelValue(session.label ?? '')
                  }}
                >
                  {session.label ?? 'Click to add label...'}
                </button>
              )}
            </div>

            {/* Session Controls */}
            <div>
              <h4 className="font-medium text-foreground mb-2">Session Controls</h4>
              <div className="grid grid-cols-3 gap-3" onClick={(e) => e.stopPropagation()}>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Thinking</label>
                  <select
                    className={`${SELECT_CLASS} w-full`}
                    defaultValue="off"
                    disabled={controllingSession !== null}
                    onChange={async (e) => {
                      await onSendAction('set-thinking', session.key, {
                        level: e.target.value as ThinkingLevel,
                      })
                    }}
                  >
                    <option value="off">Off</option>
                    <option value="minimal">Minimal</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="xhigh">X-High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Verbose</label>
                  <select
                    className={`${SELECT_CLASS} w-full`}
                    defaultValue="off"
                    disabled={controllingSession !== null}
                    onChange={async (e) => {
                      await onSendAction('set-verbose', session.key, {
                        level: e.target.value as VerboseLevel,
                      })
                    }}
                  >
                    <option value="off">Off</option>
                    <option value="on">On</option>
                    <option value="full">Full</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Reasoning</label>
                  <select
                    className={`${SELECT_CLASS} w-full`}
                    defaultValue="off"
                    disabled={controllingSession !== null}
                    onChange={async (e) => {
                      await onSendAction('set-reasoning', session.key, {
                        level: e.target.value as ReasoningLevel,
                      })
                    }}
                  >
                    <option value="off">Off</option>
                    <option value="on">On</option>
                    <option value="stream">Stream</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Model Information */}
            <div>
              <h4 className="font-medium text-foreground mb-2">Model Information</h4>
              <div className="bg-secondary rounded p-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-muted-foreground">Full Name:</span>
                    <div className="font-mono text-xs text-foreground mt-1">{modelInfo.name}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Provider:</span>
                    <div className="text-foreground mt-1">{modelInfo.provider}</div>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Description:</span>
                    <div className="text-foreground mt-1">{modelInfo.description}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex space-x-2">
              <Button
                size="xs"
                className="bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
                disabled={controllingSession !== null}
                onClick={(e) => handleControlAction(e, 'monitor')}
              >
                {controllingSession === `monitor-${session.id}` ? 'Working...' : 'Monitor'}
              </Button>
              <Button
                size="xs"
                className="bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30"
                disabled={controllingSession !== null}
                onClick={(e) => handleControlAction(e, 'pause')}
              >
                {controllingSession === `pause-${session.id}` ? 'Working...' : 'Pause'}
              </Button>
              <Button
                variant="destructive"
                size="xs"
                disabled={controllingSession !== null}
                onClick={(e) => handleControlAction(e, 'terminate')}
              >
                {controllingSession === `terminate-${session.id}` ? 'Working...' : 'Terminate'}
              </Button>

              {/* Delete */}
              {confirmingDelete === session.key ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs text-red-400">Delete?</span>
                  <Button
                    size="xs"
                    variant="destructive"
                    disabled={controllingSession !== null}
                    onClick={() => onDeleteSession(session.key)}
                  >
                    {controllingSession === `delete-${session.key}` ? '...' : 'Yes'}
                  </Button>
                  <Button
                    size="xs"
                    className="bg-secondary text-foreground border border-border hover:bg-secondary/80"
                    onClick={() => onSetConfirmingDelete(null)}
                  >
                    No
                  </Button>
                </div>
              ) : (
                <Button
                  size="xs"
                  className="bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 ml-auto"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSetConfirmingDelete(session.key)
                  }}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
