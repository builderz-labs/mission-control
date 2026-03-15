'use client'
import { create } from 'zustand'
import type { Node, Edge, Viewport } from '@xyflow/react'

export interface AgentNodeData extends Record<string, unknown> {
  label: string
  status: 'online' | 'offline' | 'busy' | 'error'
  role?: string
  agentId: number
}

export type AgentNode = Node<AgentNodeData>
export type AgentEdge = Edge

interface CanvasState {
  nodes: AgentNode[]
  edges: AgentEdge[]
  viewport: Viewport

  savedPositions: Record<string, { x: number; y: number }>

  setNodes: (nodes: AgentNode[]) => void
  setEdges: (edges: AgentEdge[]) => void
  setViewport: (viewport: Viewport) => void
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void
  updateNodeData: (nodeId: string, data: Partial<AgentNodeData>) => void
  addNode: (node: AgentNode) => void
  removeNode: (nodeId: string) => void
  addEdge: (edge: AgentEdge) => void
  removeEdge: (edgeId: string) => void
  loadSavedPositions: () => void
  persistPositions: () => void
}

const POSITIONS_KEY = 'mc-canvas-positions'

export const useCanvasStore = create<CanvasState>()((set, get) => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  savedPositions: {},

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setViewport: (viewport) => set({ viewport }),

  updateNodePosition: (nodeId, position) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, position } : n
      ),
      savedPositions: { ...state.savedPositions, [nodeId]: position },
    })),

  updateNodeData: (nodeId, data) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      ),
    })),

  addNode: (node) =>
    set((state) => ({ nodes: [...state.nodes, node] })),

  removeNode: (nodeId) =>
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    })),

  addEdge: (edge) =>
    set((state) => ({ edges: [...state.edges, edge] })),

  removeEdge: (edgeId) =>
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== edgeId),
    })),

  loadSavedPositions: () => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(POSITIONS_KEY)
      if (raw) set({ savedPositions: JSON.parse(raw) })
    } catch {}
  },

  persistPositions: () => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(POSITIONS_KEY, JSON.stringify(get().savedPositions))
    } catch {}
  },
}))
