'use client'

import { useState } from 'react'
import { type Agent } from '@/store'
import { type HeartbeatResponse } from './types'
import { statusIcons } from './types'

export function OverviewTab({
  agent,
  editing,
  formData,
  setFormData,
  onSave,
  onStatusUpdate,
  onWakeAgent,
  onEdit,
  onCancel,
  heartbeatData,
  loadingHeartbeat,
  onPerformHeartbeat
}: {
  agent: Agent
  editing: boolean
  formData: any
  setFormData: (data: any) => void
  onSave: () => Promise<void>
  onStatusUpdate: (name: string, status: Agent['status'], activity?: string) => Promise<void>
  onWakeAgent: (name: string, sessionKey: string) => Promise<void>
  onEdit: () => void
  onCancel: () => void
  heartbeatData: HeartbeatResponse | null
  loadingHeartbeat: boolean
  onPerformHeartbeat: () => Promise<void>
}) {
  const [directMessage, setDirectMessage] = useState('')
  const [messageStatus, setMessageStatus] = useState<string | null>(null)

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!directMessage.trim()) return
    try {
      setMessageStatus(null)
      const response = await fetch('/api/agents/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: agent.name,
          message: directMessage
        })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to send message')
      setDirectMessage('')
      setMessageStatus('Message sent')
    } catch (error) {
      setMessageStatus('Failed to send message')
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Status Controls */}
      <div className="p-4 bg-surface-1/50 rounded-lg">
        <h4 className="text-sm font-medium text-foreground mb-3">Status Control</h4>
        <div className="flex gap-2 mb-3">
          {(['idle', 'busy', 'offline'] as const).map(status => (
            <button
              key={status}
              onClick={() => onStatusUpdate(agent.name, status)}
              className={`px-3 py-1 text-sm rounded transition-smooth ${
                agent.status === status
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:bg-surface-2'
              }`}
            >
              {statusIcons[status]} {status}
            </button>
          ))}
        </div>

        {/* Wake Agent Button */}
        {agent.session_key && (
          <button
            onClick={() => onWakeAgent(agent.name, agent.session_key!)}
            className="w-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 py-2 rounded-md hover:bg-cyan-500/30 transition-smooth"
          >
            Wake Agent via Session
          </button>
        )}
      </div>

      {/* Direct Message */}
      <div className="p-4 bg-surface-1/50 rounded-lg">
        <h4 className="text-sm font-medium text-foreground mb-3">Direct Message</h4>
        {messageStatus && (
          <div className="text-xs text-foreground/80 mb-2">{messageStatus}</div>
        )}
        <form onSubmit={handleSendMessage} className="space-y-2">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Message</label>
            <textarea
              value={directMessage}
              onChange={(e) => setDirectMessage(e.target.value)}
              className="w-full bg-surface-1 text-foreground rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              rows={3}
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth text-xs"
            >
              Send Message
            </button>
          </div>
        </form>
      </div>

      {/* Heartbeat Check */}
      <div className="p-4 bg-surface-1/50 rounded-lg">
        <div className="flex justify-between items-center mb-3">
          <h4 className="text-sm font-medium text-foreground">Heartbeat Check</h4>
          <button
            onClick={onPerformHeartbeat}
            disabled={loadingHeartbeat}
            className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-smooth"
          >
            {loadingHeartbeat ? 'Checking...' : 'Check Now'}
          </button>
        </div>

        {heartbeatData && (
          <div className="space-y-2">
            <div className="text-sm text-foreground/80">
              <strong>Status:</strong> {heartbeatData.status}
            </div>
            <div className="text-sm text-foreground/80">
              <strong>Checked:</strong> {new Date(heartbeatData.checked_at * 1000).toLocaleString()}
            </div>

            {heartbeatData.work_items && heartbeatData.work_items.length > 0 && (
              <div className="mt-3">
                <div className="text-sm font-medium text-yellow-400 mb-2">
                  Work Items Found: {heartbeatData.total_items}
                </div>
                {heartbeatData.work_items.map((item, idx) => (
                  <div key={idx} className="text-sm text-foreground/80 ml-2">
                    • {item.type}: {item.count} items
                  </div>
                ))}
              </div>
            )}

            {heartbeatData.message && (
              <div className="text-sm text-foreground/80">
                <strong>Message:</strong> {heartbeatData.message}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Agent Details */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">Role</label>
          {editing ? (
            <input
              type="text"
              value={formData.role}
              onChange={(e) => setFormData((prev: any) => ({ ...prev, role: e.target.value }))}
              className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          ) : (
            <p className="text-foreground">{agent.role}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">Session Key</label>
          {editing ? (
            <input
              type="text"
              value={formData.session_key}
              onChange={(e) => setFormData((prev: any) => ({ ...prev, session_key: e.target.value }))}
              className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder="OpenClaw session identifier"
            />
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-foreground font-mono">{agent.session_key || 'Not set'}</p>
              {agent.session_key && (
                <div className="flex items-center gap-1 text-xs text-green-400">
                  <div className="w-2 h-2 rounded-full bg-green-400"></div>
                  <span>Bound</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Task Statistics */}
        {agent.taskStats && (
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Task Statistics</label>
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-surface-1/50 rounded p-3 text-center">
                <div className="text-lg font-semibold text-foreground">{agent.taskStats.total}</div>
                <div className="text-xs text-muted-foreground">Total</div>
              </div>
              <div className="bg-surface-1/50 rounded p-3 text-center">
                <div className="text-lg font-semibold text-blue-400">{agent.taskStats.assigned}</div>
                <div className="text-xs text-muted-foreground">Assigned</div>
              </div>
              <div className="bg-surface-1/50 rounded p-3 text-center">
                <div className="text-lg font-semibold text-yellow-400">{agent.taskStats.in_progress}</div>
                <div className="text-xs text-muted-foreground">In Progress</div>
              </div>
              <div className="bg-surface-1/50 rounded p-3 text-center">
                <div className="text-lg font-semibold text-green-400">{agent.taskStats.completed}</div>
                <div className="text-xs text-muted-foreground">Done</div>
              </div>
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Created:</span>
            <span className="text-foreground ml-2">{new Date(agent.created_at * 1000).toLocaleDateString()}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Last Updated:</span>
            <span className="text-foreground ml-2">{new Date(agent.updated_at * 1000).toLocaleDateString()}</span>
          </div>
          {agent.last_seen && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Last Seen:</span>
              <span className="text-foreground ml-2">{new Date(agent.last_seen * 1000).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 mt-6">
        {editing ? (
          <>
            <button
              onClick={onSave}
              className="flex-1 bg-primary text-primary-foreground py-2 rounded-md hover:bg-primary/90 transition-smooth"
            >
              Save Changes
            </button>
            <button
              onClick={onCancel}
              className="flex-1 bg-secondary text-muted-foreground py-2 rounded-md hover:bg-surface-2 transition-smooth"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={onEdit}
            className="flex-1 bg-primary text-primary-foreground py-2 rounded-md hover:bg-primary/90 transition-smooth"
          >
            Edit Agent
          </button>
        )}
      </div>
    </div>
  )
}
