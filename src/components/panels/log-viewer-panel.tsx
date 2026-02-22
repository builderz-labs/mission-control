'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface LogFilters {
  level?: string
  source?: string
  search?: string
  session?: string
}

export function LogViewerPanel() {
  const { logs, logFilters, setLogFilters, clearLogs, addLog } = useMissionControl()
  const [isAutoScroll, setIsAutoScroll] = useState(true)
  const [availableSources, setAvailableSources] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef<boolean>(true)
  const logsRef = useRef(logs)
  const logFiltersRef = useRef(logFilters)

  // Update ref when autoScroll state changes
  useEffect(() => {
    autoScrollRef.current = isAutoScroll
  }, [isAutoScroll])

  // Keep refs in sync so callbacks don't need `logs` / `logFilters` deps.
  useEffect(() => {
    logsRef.current = logs
  }, [logs])

  useEffect(() => {
    logFiltersRef.current = logFilters
  }, [logFilters])

  const loadLogs = useCallback(async (tail = false) => {
    console.log(`LogViewer: Loading logs (tail=${tail})`)
    setIsLoading(!tail) // Only show loading for initial load, not for tailing

    try {
      const currentFilters = logFiltersRef.current
      const currentLogs = logsRef.current

      const params = new URLSearchParams({
        action: tail ? 'tail' : 'recent',
        limit: '200',
        ...(currentFilters.level && { level: currentFilters.level }),
        ...(currentFilters.source && { source: currentFilters.source }),
        ...(currentFilters.search && { search: currentFilters.search }),
        ...(currentFilters.session && { session: currentFilters.session }),
        ...(tail && currentLogs.length > 0 && { since: currentLogs[0]?.timestamp.toString() })
      })

      console.log(`LogViewer: Fetching /api/logs?${params}`)
      const response = await fetch(`/api/logs?${params}`)
      const data = await response.json()

      console.log(`LogViewer: Received ${data.logs?.length || 0} logs from API`)

      if (data.logs && data.logs.length > 0) {
        if (tail) {
          // Add new logs for tail mode - prepend to existing logs
          let newLogsAdded = 0
          const existingIds = new Set((currentLogs || []).map((l: any) => l?.id).filter(Boolean))
          data.logs.reverse().forEach((log: any) => {
            if (existingIds.has(log?.id)) return
            addLog(log)
            newLogsAdded++
          })
          console.log(`LogViewer: Added ${newLogsAdded} new logs (tail mode)`)
        } else {
          // Replace logs for initial load or refresh
          console.log(`LogViewer: Clearing existing logs and loading ${data.logs.length} logs`)
          clearLogs() // Clear existing logs
          data.logs.reverse().forEach((log: any) => {
            addLog(log)
          })
          console.log(`LogViewer: Successfully added ${data.logs.length} logs to store`)
        }
      } else {
        console.log('LogViewer: No logs received from API')
      }
    } catch (error) {
      console.error('LogViewer: Failed to load logs:', error)
    } finally {
      setIsLoading(false)
    }
  }, [addLog, clearLogs])

  const loadSources = useCallback(async () => {
    try {
      const response = await fetch('/api/logs?action=sources')
      const data = await response.json()
      setAvailableSources(data.sources || [])
    } catch (error) {
      console.error('Failed to load log sources:', error)
    }
  }, [])

  // Load initial logs and sources
  useEffect(() => {
    console.log('LogViewer: Initial load started')
    loadLogs()
    loadSources()
  }, [loadLogs, loadSources])

  // Smart polling for log tailing (10s, visibility-aware, logs mostly come via WS)
  const pollLogs = useCallback(() => {
    if (autoScrollRef.current && !isLoading) {
      loadLogs(true) // tail mode
    }
  }, [isLoading, loadLogs])

  useSmartPoll(pollLogs, 30000, { pauseWhenConnected: true })

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (isAutoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs, isAutoScroll])

  const handleFilterChange = (newFilters: Partial<LogFilters>) => {
    setLogFilters(newFilters)
    // Reload logs with new filters
    setTimeout(() => loadLogs(), 100)
  }

  const handleScrollToBottom = () => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }

  const getLogLevelColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'error': return 'text-red-400'
      case 'warn': return 'text-yellow-400'
      case 'info': return 'text-blue-400'
      case 'debug': return 'text-muted-foreground'
      default: return 'text-foreground'
    }
  }

  const getLogLevelBg = (level: string) => {
    switch (level.toLowerCase()) {
      case 'error': return 'bg-red-500/10 border-red-500/20'
      case 'warn': return 'bg-yellow-500/10 border-yellow-500/20'
      case 'info': return 'bg-blue-500/10 border-blue-500/20'
      case 'debug': return 'bg-gray-500/10 border-gray-500/20'
      default: return 'bg-secondary border-border'
    }
  }

  const filteredLogs = logs.filter(log => {
    if (logFilters.level && log.level !== logFilters.level) return false
    if (logFilters.source && log.source !== logFilters.source) return false
    if (logFilters.search && !log.message.toLowerCase().includes(logFilters.search.toLowerCase())) return false
    if (logFilters.session && (!log.session || !log.session.includes(logFilters.session))) return false
    return true
  })

  // Debug logging
  console.log(`LogViewer: Store has ${logs.length} logs, filtered to ${filteredLogs.length}`)

  return (
    <div className="flex flex-col h-full p-6 space-y-4">
      <div className="border-b border-border pb-4">
        <h1 className="text-3xl font-bold text-foreground">Log Viewer</h1>
        <p className="text-muted-foreground mt-2">
          Real-time streaming logs from ClawdBot gateway and system
        </p>
      </div>

      {/* Filters and Controls */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {/* Level Filter */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Level
            </label>
            <select
              value={logFilters.level || ''}
              onChange={(e) => handleFilterChange({ level: e.target.value || undefined })}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">All levels</option>
              <option value="error">Error</option>
              <option value="warn">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </div>

          {/* Source Filter */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Source
            </label>
            <select
              value={logFilters.source || ''}
              onChange={(e) => handleFilterChange({ source: e.target.value || undefined })}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">All sources</option>
              {availableSources.map((source) => (
                <option key={source} value={source}>{source}</option>
              ))}
            </select>
          </div>

          {/* Session Filter */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Session
            </label>
            <input
              type="text"
              value={logFilters.session || ''}
              onChange={(e) => handleFilterChange({ session: e.target.value || undefined })}
              placeholder="Session ID"
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Search Filter */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Search
            </label>
            <input
              type="text"
              value={logFilters.search || ''}
              onChange={(e) => handleFilterChange({ search: e.target.value || undefined })}
              placeholder="Search messages..."
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Controls */}
          <div className="flex items-end space-x-2">
            <button
              onClick={() => setIsAutoScroll(!isAutoScroll)}
              className={`px-3 py-2 text-sm rounded-md font-medium transition-colors ${
                isAutoScroll
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-secondary text-muted-foreground border border-border'
              }`}
            >
              {isAutoScroll ? 'Auto' : 'Manual'}
            </button>
            <button
              onClick={handleScrollToBottom}
              className="px-3 py-2 text-sm bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-md font-medium hover:bg-blue-500/30 transition-colors"
            >
              Bottom
            </button>
          </div>

          {/* Clear Logs */}
          <div className="flex items-end">
            <button
              onClick={clearLogs}
              className="px-3 py-2 text-sm bg-red-500/20 text-red-400 border border-red-500/30 rounded-md font-medium hover:bg-red-500/30 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Log Stats */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>
          Showing {filteredLogs.length} of {logs.length} logs
        </div>
        <div>
          Auto-scroll: {isAutoScroll ? 'ON' : 'OFF'} • 
          Last updated: {logs.length > 0 ? new Date(logs[0]?.timestamp).toLocaleTimeString() : 'Never'}
        </div>
      </div>

      {/* Log Display */}
      <div className="flex-1 bg-card border border-border rounded-lg overflow-hidden">
        <div 
          ref={logContainerRef}
          className="h-full overflow-auto p-4 space-y-2 font-mono text-sm"
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              <span className="ml-3 text-muted-foreground">Loading logs...</span>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              No logs match the current filters
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div 
                key={log.id} 
                className={`border-l-4 pl-4 py-2 rounded-r-md ${getLogLevelBg(log.level)}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 text-xs">
                      <span className="text-muted-foreground">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className={`font-medium uppercase ${getLogLevelColor(log.level)}`}>
                        {log.level}
                      </span>
                      <span className="text-muted-foreground">
                        [{log.source}]
                      </span>
                      {log.session && (
                        <span className="text-muted-foreground">
                          session:{log.session}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-foreground break-words">
                      {log.message}
                    </div>
                    {log.data && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                          Additional data
                        </summary>
                        <pre className="mt-1 text-xs text-muted-foreground overflow-auto">
                          {JSON.stringify(log.data, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
