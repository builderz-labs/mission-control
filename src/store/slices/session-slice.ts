'use client'

import type { StateCreator } from 'zustand'

export interface Session {
  id: string
  key: string
  kind: string
  age: string
  model: string
  tokens: string
  flags: string[]
  active: boolean
  startTime?: number
  lastActivity?: number
  messageCount?: number
  cost?: number
  label?: string
  lastUserPrompt?: string
}

export interface SessionSlice {
  sessions: Session[]
  selectedSession: string | null
  setSessions: (sessions: Session[]) => void
  setSelectedSession: (sessionId: string | null) => void
  updateSession: (sessionId: string, updates: Partial<Session>) => void
}

// Session management slice — tracks active Claude/agent sessions
export const createSessionSlice: StateCreator<SessionSlice, [], [], SessionSlice> = (set) => ({
  sessions: [],
  selectedSession: null,

  setSessions: (sessions) => set({ sessions }),

  setSelectedSession: (sessionId) => set({ selectedSession: sessionId }),

  updateSession: (sessionId, updates) =>
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId ? { ...session, ...updates } : session
      ),
    })),
})
