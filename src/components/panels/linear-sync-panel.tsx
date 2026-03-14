'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'

interface LinearTeam {
  id: string
  name: string
  key: string
}

interface SyncRecord {
  id: number
  team_id: string
  last_synced_at: number
  issue_count: number
  sync_direction: string
  status: string
  error: string | null
  created_at: number
}

export function LinearSyncPanel() {
  const [teams, setTeams] = useState<LinearTeam[]>([])
  const [syncHistory, setSyncHistory] = useState<SyncRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 4000)
  }

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/linear', {
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const data = await res.json()
        setTeams(data.teams || [])
      }

      const syncRes = await fetch('/api/linear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
        signal: AbortSignal.timeout(8000),
      })
      if (syncRes.ok) {
        const data = await syncRes.json()
        setSyncHistory(data.syncs || [])
      }
    } catch (err) {
      console.error('Failed to load Linear data', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/projects', {
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const data = await res.json()
        const projectsWithLinear = (data.projects || []).filter(
          (p: any) => p.linear_team_id && p.linear_sync_enabled
        )

        if (projectsWithLinear.length === 0) {
          showFeedback(false, 'No projects with Linear sync enabled')
          return
        }

        let totalPulled = 0
        let totalPushed = 0

        for (const project of projectsWithLinear) {
          const syncRes = await fetch('/api/linear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sync-project', project_id: project.id }),
            signal: AbortSignal.timeout(30000),
          })
          const syncData = await syncRes.json()
          if (syncRes.ok) {
            totalPulled += syncData.pulled || 0
            totalPushed += syncData.pushed || 0
          }
        }

        showFeedback(true, `Synced: ${totalPulled} pulled, ${totalPushed} pushed`)
        loadData()
      } else {
        showFeedback(false, 'Failed to fetch projects')
      }
    } catch (err) {
      showFeedback(false, 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return <div className="text-muted-foreground">Loading Linear...</div>
  }

  return (
    <div className="space-y-6">
      {feedback && (
        <div className={`p-3 rounded-md text-sm ${feedback.ok ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
          {feedback.text}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Linear Integration</h3>
          <p className="text-sm text-muted-foreground">Bidirectional sync with Linear issues</p>
        </div>
        <Button onClick={handleSync} disabled={syncing || teams.length === 0}>
          {syncing ? 'Syncing...' : 'Sync Now'}
        </Button>
      </div>

      {/* Connection Status */}
      <div className="p-4 rounded-md bg-surface-1 border border-border">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${teams.length > 0 ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm font-medium">
            {teams.length > 0 ? 'Connected' : 'Not configured'}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {teams.length > 0
            ? `Connected to ${teams.length} team${teams.length > 1 ? 's' : ''}`
            : 'Set LINEAR_API_KEY environment variable to connect'}
        </p>
      </div>

      {/* Teams */}
      {teams.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">Available Teams</h4>
          <div className="space-y-1">
            {teams.map(team => (
              <div key={team.id} className="flex items-center justify-between p-2 bg-surface-1 rounded-md">
                <div>
                  <div className="text-sm font-medium">{team.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{team.key}</div>
                </div>
                <div className="text-xs text-muted-foreground">{team.id.slice(0, 8)}...</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sync History */}
      <div>
        <h4 className="text-sm font-medium mb-2">Sync History</h4>
        <div className="space-y-1 max-h-64 overflow-auto">
          {syncHistory.map(sync => (
            <div key={sync.id} className="flex items-center justify-between p-2 bg-surface-1 rounded-md">
              <div className="text-xs">
                <div className="font-medium">{sync.sync_direction} • {sync.issue_count} issues</div>
                <div className="text-muted-foreground">
                  {new Date(sync.created_at * 1000).toLocaleString()}
                </div>
                {sync.error && (
                  <div className="text-red-400 mt-1">{sync.error}</div>
                )}
              </div>
              <div className={`text-xs px-2 py-1 rounded ${
                sync.status === 'success' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
              }`}>
                {sync.status}
              </div>
            </div>
          ))}
          {syncHistory.length === 0 && (
            <div className="text-muted-foreground text-sm">No sync history</div>
          )}
        </div>
      </div>

      {/* Setup Guide */}
      {teams.length === 0 && (
        <div className="p-4 rounded-md bg-surface-1 border border-border">
          <h4 className="text-sm font-medium mb-2">Setup Instructions</h4>
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
            <li>Generate a Linear API key at <a href="https://linear.app/settings/api" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">linear.app/settings/api</a></li>
            <li>Add <code className="bg-surface-2 px-1 rounded">LINEAR_API_KEY=lin_api_xxx</code> to your .env</li>
            <li>Restart the server</li>
            <li>Configure Linear team in Project Settings</li>
            <li>Enable "Linear Sync" toggle</li>
          </ol>
        </div>
      )}
    </div>
  )
}
