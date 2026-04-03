'use client'

import type { StateCreator } from 'zustand'
import type { JsonValue } from '../shared-types'

export interface Agent {
  id: number
  name: string
  role: string
  session_key?: string
  soul_content?: string
  working_memory?: string
  status: 'offline' | 'idle' | 'busy' | 'error'
  last_seen?: number
  last_activity?: string
  created_at: number
  updated_at: number
  config?: JsonValue
  taskStats?: {
    total: number
    assigned: number
    in_progress: number
    quality_review: number
    done: number
    completed: number
  }
}

export interface SpawnRequest {
  id: string
  task: string
  model: string
  label: string
  timeoutSeconds: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  createdAt: number
  completedAt?: number
  result?: string
  error?: string
}

export interface AgentSlice {
  agents: Agent[]
  selectedAgent: Agent | null
  setAgents: (agents: Agent[]) => void
  setSelectedAgent: (agent: Agent | null) => void
  addAgent: (agent: Agent) => void
  updateAgent: (agentId: number, updates: Partial<Agent>) => void
  deleteAgent: (agentId: number) => void

  // Spawn requests (sub-agent orchestration)
  spawnRequests: SpawnRequest[]
  addSpawnRequest: (request: SpawnRequest) => void
  updateSpawnRequest: (id: string, updates: Partial<SpawnRequest>) => void
}

// Agent management slice — CRUD for agents and their spawn requests
export const createAgentSlice: StateCreator<AgentSlice, [], [], AgentSlice> = (set) => ({
  agents: [],
  selectedAgent: null,
  spawnRequests: [],

  setAgents: (agents) => set({ agents }),

  setSelectedAgent: (agent) => set({ selectedAgent: agent }),

  addAgent: (agent) =>
    set((state) => ({ agents: [agent, ...state.agents] })),

  updateAgent: (agentId, updates) =>
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === agentId ? { ...agent, ...updates } : agent
      ),
      selectedAgent:
        state.selectedAgent?.id === agentId
          ? { ...state.selectedAgent, ...updates }
          : state.selectedAgent,
    })),

  deleteAgent: (agentId) =>
    set((state) => ({
      agents: state.agents.filter((agent) => agent.id !== agentId),
      selectedAgent:
        state.selectedAgent?.id === agentId ? null : state.selectedAgent,
    })),

  addSpawnRequest: (request) =>
    set((state) => ({
      spawnRequests: [request, ...state.spawnRequests].slice(0, 500),
    })),

  updateSpawnRequest: (id, updates) =>
    set((state) => ({
      spawnRequests: state.spawnRequests.map((req) =>
        req.id === id ? { ...req, ...updates } : req
      ),
    })),
})
