import type { StateCreator } from 'zustand'
import type { Agent } from '../types'

export interface AgentSlice {
  agents: Agent[]
  selectedAgent: Agent | null
  setAgents: (agents: Agent[]) => void
  setSelectedAgent: (agent: Agent | null) => void
  addAgent: (agent: Agent) => void
  updateAgent: (agentId: number, updates: Partial<Agent>) => void
  deleteAgent: (agentId: number) => void
}

export const createAgentSlice: StateCreator<AgentSlice, [], [], AgentSlice> = (set) => ({
  agents: [],
  selectedAgent: null,
  setAgents: (agents) => set({ agents }),
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),
  addAgent: (agent) =>
    set((state) => ({
      agents: [agent, ...state.agents]
    })),
  updateAgent: (agentId, updates) =>
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === agentId ? { ...agent, ...updates } : agent
      ),
      selectedAgent: state.selectedAgent?.id === agentId
        ? { ...state.selectedAgent, ...updates }
        : state.selectedAgent
    })),
  deleteAgent: (agentId) =>
    set((state) => ({
      agents: state.agents.filter((agent) => agent.id !== agentId),
      selectedAgent: state.selectedAgent?.id === agentId ? null : state.selectedAgent
    })),
})
