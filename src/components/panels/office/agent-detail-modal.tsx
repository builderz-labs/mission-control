'use client'

import type { Agent } from '@/store'
import type { OfficeAction } from './types'
import { hashColor, getInitials, statusDot, statusLabel, formatLastSeen } from './types'

interface AgentDetailModalProps {
  selectedAgent: Agent
  isLocalMode: boolean
  flightDeckLaunching: boolean
  setSelectedAgent: (agent: Agent | null) => void
  executeAgentAction: (agent: Agent, action: OfficeAction) => void
  openFlightDeck: (agent: Agent) => void
}

export function AgentDetailModal({
  selectedAgent,
  isLocalMode,
  flightDeckLaunching,
  setSelectedAgent,
  executeAgentAction,
  openFlightDeck,
}: AgentDetailModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedAgent(null)}>
      <div className="bg-card border border-border rounded-xl max-w-sm w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-14 h-14 rounded-full ${hashColor(selectedAgent.name)} flex items-center justify-center text-white font-bold text-lg ring-2 ring-offset-2 ring-offset-card ${selectedAgent.status === 'busy' ? 'ring-yellow-500' : selectedAgent.status === 'idle' ? 'ring-green-500' : selectedAgent.status === 'error' ? 'ring-red-500' : 'ring-gray-600'}`}>
              {getInitials(selectedAgent.name)}
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">{selectedAgent.name}</h3>
              <p className="text-sm text-muted-foreground">{selectedAgent.role}</p>
            </div>
          </div>
          <button onClick={() => setSelectedAgent(null)} className="text-muted-foreground hover:text-foreground text-xl">×</button>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${statusDot[selectedAgent.status]}`} />
            <span className="font-medium text-foreground">{statusLabel[selectedAgent.status]}</span>
            <span className="text-muted-foreground ml-auto">{formatLastSeen(selectedAgent.last_seen)}</span>
          </div>

          {selectedAgent.last_activity && (
            <div className="bg-secondary rounded-lg p-3">
              <span className="text-xs text-muted-foreground block mb-1">Current Activity</span>
              <span className="text-foreground text-sm">{selectedAgent.last_activity}</span>
            </div>
          )}

          {selectedAgent.taskStats && (
            <div className="grid grid-cols-4 gap-2">
              <div className="text-center bg-secondary rounded-lg p-2">
                <div className="text-lg font-bold text-foreground">{selectedAgent.taskStats.total}</div>
                <div className="text-[10px] text-muted-foreground">Total</div>
              </div>
              <div className="text-center bg-secondary rounded-lg p-2">
                <div className="text-lg font-bold text-blue-400">{selectedAgent.taskStats.assigned}</div>
                <div className="text-[10px] text-muted-foreground">Assigned</div>
              </div>
              <div className="text-center bg-secondary rounded-lg p-2">
                <div className="text-lg font-bold text-yellow-400">{selectedAgent.taskStats.in_progress}</div>
                <div className="text-[10px] text-muted-foreground">Active</div>
              </div>
              <div className="text-center bg-secondary rounded-lg p-2">
                <div className="text-lg font-bold text-green-400">{selectedAgent.taskStats.completed}</div>
                <div className="text-[10px] text-muted-foreground">Done</div>
              </div>
            </div>
          )}

          {selectedAgent.session_key && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Session:</span> <code className="font-mono">{selectedAgent.session_key}</code>
            </div>
          )}

          <div className="pt-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Quick Actions</div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => executeAgentAction(selectedAgent, 'focus')}
                className="h-8 px-2 rounded border border-border bg-secondary text-[11px] hover:bg-surface-2"
              >
                Focus
              </button>
              <button
                onClick={() => executeAgentAction(selectedAgent, 'pair')}
                className="h-8 px-2 rounded border border-border bg-secondary text-[11px] hover:bg-surface-2"
              >
                Pair
              </button>
              <button
                onClick={() => executeAgentAction(selectedAgent, 'break')}
                className="h-8 px-2 rounded border border-border bg-secondary text-[11px] hover:bg-surface-2"
              >
                Break
              </button>
            </div>
          </div>

          {isLocalMode && (
            <div className="pt-1">
              <button
                onClick={() => openFlightDeck(selectedAgent)}
                disabled={flightDeckLaunching}
                className="w-full h-9 px-3 rounded-md border border-border bg-secondary text-foreground text-xs hover:bg-surface-2 transition-smooth"
              >
                {flightDeckLaunching ? 'Opening Flight Deck...' : 'Open in Flight Deck'}
              </button>
              <div className="text-[10px] text-muted-foreground mt-1">
                Private/pro companion app for session deep-dive
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
