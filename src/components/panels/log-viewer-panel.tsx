'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { createClientLogger } from '@/lib/client-logger'
import { downloadText } from '@/lib/download'
import { type LogEntry } from '@/store/slices/log-slice'
import { type LogFilters } from './log-viewer/types'
import { LogFiltersBar } from './log-viewer/log-filters-bar'
import { LogEntryRow } from './log-viewer/log-entry-row'
import { LogHeader } from './log-viewer/log-header'

const log = createClientLogger('LogViewer')

const MAX_LOG_BUFFER = 1000

export function LogViewerPanel(): React.JSX.Element {
  const { logs, logFilters, setLogFilters, clearLogs, addLog } = useMissionControl()
  const [isAutoScroll, setIsAutoScroll] = useState(true)
  const [availableSources, setAvailableSources] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logFilePath, setLogFilePath] = useState<string | null>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef<boolean>(true)
  const logsRef = useRef(logs)
  const logFiltersRef = useRef(logFilters)
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => { if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current) }, [])

  useEffect(() => { autoScrollRef.current = isAutoScroll }, [isAutoScroll])
  useEffect(() => { logsRef.current = logs }, [logs])
  useEffect(() => { logFiltersRef.current = logFilters }, [logFilters])

  const loadLogs = useCallback(async (tail = false): Promise<void> => {
    setIsLoading(!tail)
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
        ...(tail && currentLogs.length > 0 && { since: currentLogs[0]?.timestamp.toString() }),
      })
      const response = await fetch(`/api/logs?${params}`, { signal: AbortSignal.timeout(8000) })
      const data = await response.json()
      if (data.logs && data.logs.length > 0) {
        if (tail) {
          const existingIds = new Set((currentLogs || []).map((l: LogEntry) => l?.id).filter(Boolean))
          data.logs.reverse().forEach((entry: LogEntry) => {
            if (existingIds.has(entry?.id)) return
            addLog(entry)
          })
        } else {
          clearLogs()
          data.logs.reverse().forEach((entry: LogEntry) => { addLog(entry) })
        }
      }
    } catch (err) {
      log.error('Failed to load logs:', err)
      setError('Failed to load logs. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [addLog, clearLogs])

  const loadSources = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/logs?action=sources', { signal: AbortSignal.timeout(8000) })
      const data = await response.json()
      setAvailableSources(data.sources || [])
    } catch (err) {
      log.error('Failed to load log sources:', err)
    }
  }, [])

  const loadLogFilePath = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/status', { signal: AbortSignal.timeout(8000) })
      const data = await response.json()
      setLogFilePath(data?.config?.logFile || data?.logFile || null)
    } catch {
      // Gateway may not expose this — silently ignore
    }
  }, [])

  useEffect(() => { loadLogs(); loadSources(); loadLogFilePath() }, [loadLogs, loadSources, loadLogFilePath])

  const pollLogs = useCallback((): void => {
    if (autoScrollRef.current && !isLoading) loadLogs(true)
  }, [isLoading, loadLogs])

  useSmartPoll(pollLogs, 30000, { pauseWhenConnected: true })

  useEffect(() => {
    if (isAutoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs, isAutoScroll])

  const handleFilterChange = (newFilters: Partial<LogFilters>): void => {
    setLogFilters(newFilters)
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current)
    filterDebounceRef.current = setTimeout(() => loadLogs(), 100)
  }

  const handleScrollToBottom = (): void => {
    if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
  }

  const filteredLogs = logs.filter((entry: LogEntry) => {
    if (logFilters.level && entry.level !== logFilters.level) return false
    if (logFilters.source && entry.source !== logFilters.source) return false
    if (logFilters.search && !entry.message.toLowerCase().includes(logFilters.search.toLowerCase())) return false
    if (logFilters.session && (!entry.session || !entry.session.includes(logFilters.session))) return false
    return true
  })

  const handleExportText = useCallback((): void => {
    const lines = filteredLogs.map((entry: LogEntry) => {
      const ts = new Date(entry.timestamp).toISOString()
      return `[${ts}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`
    })
    downloadText(lines.join('\n'), `logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`, 'text/plain')
  }, [filteredLogs])

  const handleExportJson = useCallback((): void => {
    downloadText(JSON.stringify(filteredLogs, null, 2), `logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`, 'application/json')
  }, [filteredLogs])

  return (
    <div className="flex flex-col h-full p-6 space-y-4">
      {error && (
        <div className="mx-4 my-3 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="flex-1">{error}</span>
          <button onClick={() => { setError(null); loadLogs() }} className="shrink-0 rounded px-2.5 py-1 text-xs font-medium bg-red-400 text-red-950 hover:bg-red-300">
            Retry
          </button>
        </div>
      )}

      <LogHeader
        logFilePath={logFilePath}
        totalCount={logs.length}
        filteredCount={filteredLogs.length}
        isBufferFull={logs.length >= MAX_LOG_BUFFER}
        maxBuffer={MAX_LOG_BUFFER}
        isAutoScroll={isAutoScroll}
        lastTimestamp={logs[0]?.timestamp}
      />

      <LogFiltersBar
        logFilters={logFilters}
        availableSources={availableSources}
        isAutoScroll={isAutoScroll}
        filteredCount={filteredLogs.length}
        onFilterChange={handleFilterChange}
        onToggleAutoScroll={() => setIsAutoScroll(!isAutoScroll)}
        onScrollToBottom={handleScrollToBottom}
        onExportText={handleExportText}
        onExportJson={handleExportJson}
        onClearLogs={clearLogs}
      />

      <div className="flex-1 bg-card border border-border rounded-lg overflow-hidden">
        <div ref={logContainerRef} className="h-full overflow-auto p-4 space-y-2 font-mono text-sm">
          {isLoading ? (
            <Loader variant="panel" label="Loading logs" />
          ) : filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">No logs</div>
          ) : (
            filteredLogs.map((entry: LogEntry) => <LogEntryRow key={entry.id} entry={entry} />)
          )}
        </div>
      </div>
    </div>
  )
}
