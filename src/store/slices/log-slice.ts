'use client'

import type { StateCreator } from 'zustand'
import type { JsonValue } from '../shared-types'

export interface LogEntry {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  source: string
  session?: string
  message: string
  data?: JsonValue
}

export interface CronJob {
  id?: string
  name: string
  schedule: string
  command: string
  model?: string
  agentId?: string
  timezone?: string
  delivery?: string
  enabled: boolean
  lastRun?: number
  nextRun?: number
  lastStatus?: 'success' | 'error' | 'running'
  lastError?: string
}

export interface MemoryFile {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  modified?: number
  children?: MemoryFile[]
}

export interface LogSlice {
  // Application log stream
  logs: LogEntry[]
  logFilters: {
    level?: string
    source?: string
    session?: string
    search?: string
  }
  addLog: (log: LogEntry) => void
  setLogFilters: (
    filters: Partial<{ level?: string; source?: string; session?: string; search?: string }>
  ) => void
  clearLogs: () => void

  // Cron job management
  cronJobs: CronJob[]
  setCronJobs: (jobs: CronJob[]) => void
  updateCronJob: (name: string, updates: Partial<CronJob>) => void

  // Memory file browser
  memoryFiles: MemoryFile[]
  selectedMemoryFile: string | null
  memoryContent: string | null
  memoryFileLinks: { wikiLinks: unknown[]; incoming: string[]; outgoing: string[] } | null
  memoryHealth: unknown | null
  setMemoryFiles: (files: MemoryFile[]) => void
  setSelectedMemoryFile: (path: string | null) => void
  setMemoryContent: (content: string | null) => void
  setMemoryFileLinks: (
    links: { wikiLinks: unknown[]; incoming: string[]; outgoing: string[] } | null
  ) => void
  setMemoryHealth: (health: unknown | null) => void
}

// Log, cron, and memory slice — application logs, scheduled jobs, memory file browser
export const createLogSlice: StateCreator<LogSlice, [], [], LogSlice> = (set) => ({
  logs: [],
  logFilters: {},
  cronJobs: [],
  memoryFiles: [],
  selectedMemoryFile: null,
  memoryContent: null,
  memoryFileLinks: null,
  memoryHealth: null,

  addLog: (log) =>
    set((state) => {
      const existingIndex = state.logs.findIndex((l) => l.id === log.id)
      if (existingIndex !== -1) {
        // Update in-place via immutable replacement, keeping sort order
        const updated = [...state.logs]
        updated[existingIndex] = log
        return { logs: updated }
      }
      // Newest first, cap at 1000
      return { logs: [log, ...state.logs].slice(0, 1000) }
    }),

  setLogFilters: (filters) =>
    set((state) => ({ logFilters: { ...state.logFilters, ...filters } })),

  clearLogs: () => set({ logs: [] }),

  setCronJobs: (jobs) => set({ cronJobs: jobs }),

  updateCronJob: (name, updates) =>
    set((state) => ({
      cronJobs: state.cronJobs.map((job) =>
        job.name === name ? { ...job, ...updates } : job
      ),
    })),

  setMemoryFiles: (files) => set({ memoryFiles: files }),
  setSelectedMemoryFile: (path) => set({ selectedMemoryFile: path }),
  setMemoryContent: (content) => set({ memoryContent: content }),
  setMemoryFileLinks: (links) => set({ memoryFileLinks: links }),
  setMemoryHealth: (health) => set({ memoryHealth: health }),
})
