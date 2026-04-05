'use client'

import { Button } from '@/components/ui/button'
import { type Agent, statusColors } from './agent-squad-panel-types'

interface AgentCardProps {
  agent: Agent
  formatLastSeen: (timestamp?: number) => string
  onSelect: (agent: Agent) => void
  onStatusUpdate: (name: string, status: Agent['status'], activity?: string) => Promise<void>
  wakeLabel: string
  busyLabel: string
  sleepLabel: string
  sessionLabel: string
  lastSeenLabel: string
  activityLabel: string
  totalTasksLabel: string
  inProgressLabel: string
}

export function AgentCard({
  agent,
  formatLastSeen,
  onSelect,
  onStatusUpdate,
  wakeLabel,
  busyLabel,
  sleepLabel,
  sessionLabel,
  lastSeenLabel,
  activityLabel,
  totalTasksLabel,
  inProgressLabel,
}: AgentCardProps): React.JSX.Element {
  return (
    <div
      className="bg-gray-800 rounded-lg p-4 border-l-4 border-gray-600 hover:bg-gray-750 transition-colors cursor-pointer"
      onClick={() => onSelect(agent)}
    >
      {/* Agent Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-white text-lg">{agent.name}</h3>
          <p className="text-gray-400 text-sm">{agent.role}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${statusColors[agent.status]} animate-pulse`} />
          <span className="text-xs text-gray-400">{agent.status}</span>
        </div>
      </div>

      {/* Session Info */}
      {agent.session_key && (
        <div className="text-xs text-gray-400 mb-2">
          <span className="font-medium">{sessionLabel}:</span> {agent.session_key}
        </div>
      )}

      {/* Task Stats */}
      {agent.taskStats && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-gray-700/50 rounded p-2 text-center">
            <div className="text-lg font-semibold text-white">{agent.taskStats.total}</div>
            <div className="text-xs text-gray-400">{totalTasksLabel}</div>
          </div>
          <div className="bg-gray-700/50 rounded p-2 text-center">
            <div className="text-lg font-semibold text-yellow-400">{agent.taskStats.in_progress}</div>
            <div className="text-xs text-gray-400">{inProgressLabel}</div>
          </div>
        </div>
      )}

      {/* Last Activity */}
      <div className="text-xs text-gray-400 mb-3">
        <div>
          <span className="font-medium">{lastSeenLabel}:</span> {formatLastSeen(agent.last_seen)}
        </div>
        {agent.last_activity && (
          <div className="mt-1 truncate" title={agent.last_activity}>
            <span className="font-medium">{activityLabel}:</span> {agent.last_activity}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="flex gap-1">
        <Button
          onClick={(e) => { e.stopPropagation(); void onStatusUpdate(agent.name, 'idle', 'Manually activated') }}
          disabled={agent.status === 'idle'}
          variant="success"
          size="xs"
          className="flex-1"
        >
          {wakeLabel}
        </Button>
        <Button
          onClick={(e) => { e.stopPropagation(); void onStatusUpdate(agent.name, 'busy', 'Manually set to busy') }}
          disabled={agent.status === 'busy'}
          size="xs"
          className="flex-1 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30"
        >
          {busyLabel}
        </Button>
        <Button
          onClick={(e) => { e.stopPropagation(); void onStatusUpdate(agent.name, 'offline', 'Manually set offline') }}
          disabled={agent.status === 'offline'}
          variant="secondary"
          size="xs"
          className="flex-1"
        >
          {sleepLabel}
        </Button>
      </div>
    </div>
  )
}
