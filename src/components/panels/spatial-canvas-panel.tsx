'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type OnNodesChange,
  type OnEdgesChange,
  type NodeMouseHandler,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore, type AgentNode, type AgentEdge, type AgentNodeData } from '@/store/canvas-store'
import { useMissionControl } from '@/store'
import { agentNodeTypes, agentEdgeTypes } from '@/components/spatial/node-types'
import { applyDagreLayout } from '@/lib/spatial-layout'
import { useSpatialSSE } from '@/hooks/use-spatial-sse'
import type { Agent } from '@/store/types'

interface RelationshipRow {
  id: number
  source_agent_id: number
  target_agent_id: number
  type: string
  source_name: string
  target_name: string
}

interface PositionRow {
  agent_id: number
  x: number
  y: number
}

export function SpatialCanvasPanel() {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const setNodes = useCanvasStore((s) => s.setNodes)
  const setEdges = useCanvasStore((s) => s.setEdges)
  const persistPositions = useCanvasStore((s) => s.persistPositions)

  const [loading, setLoading] = useState(true)
  const [direction, setDirection] = useState<'TB' | 'LR'>('TB')
  const [selectedAgentDetail, setSelectedAgentDetail] = useState<Agent | null>(null)

  // Wire SSE updates
  useSpatialSSE()

  // Fetch agents, relationships, and positions on mount
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [agentsRes, relsRes, posRes] = await Promise.all([
          fetch('/api/agents?limit=200'),
          fetch('/api/spatial/relationships'),
          fetch('/api/spatial/positions'),
        ])

        if (cancelled) return

        const agentsData = await agentsRes.json()
        const relsData = await relsRes.json()
        const posData = await posRes.json()

        const agents: Agent[] = agentsData.agents || []
        const relationships: RelationshipRow[] = relsData.relationships || []
        const savedPositions: PositionRow[] = posData.positions || []

        // Build position lookup
        const posMap = new Map<number, { x: number; y: number }>()
        for (const p of savedPositions) {
          posMap.set(p.agent_id, { x: p.x, y: p.y })
        }

        // Create nodes
        const newNodes: AgentNode[] = agents.map((agent) => {
          const saved = posMap.get(agent.id)
          return {
            id: `agent-${agent.id}`,
            type: 'agent' as const,
            position: saved ?? { x: 0, y: 0 },
            data: {
              label: agent.name,
              status: agent.status === 'idle' ? 'online' : (agent.status as AgentNodeData['status']),
              role: agent.role,
              agentId: agent.id,
            } satisfies AgentNodeData,
          }
        })

        // Create edges
        const newEdges: AgentEdge[] = relationships.map((rel) => ({
          id: `rel-${rel.id}`,
          source: `agent-${rel.source_agent_id}`,
          target: `agent-${rel.target_agent_id}`,
          type: rel.type,
        }))

        // Apply dagre layout only to nodes without saved positions
        const nodesWithPositions = newNodes.filter((n) => posMap.has(parseInt(n.id.replace('agent-', ''))))
        const nodesWithoutPositions = newNodes.filter((n) => !posMap.has(parseInt(n.id.replace('agent-', ''))))

        if (nodesWithoutPositions.length > 0) {
          const { nodes: layoutNodes } = applyDagreLayout(nodesWithoutPositions, newEdges, { direction })
          setNodes([...nodesWithPositions, ...layoutNodes])
        } else {
          setNodes(newNodes)
        }

        setEdges(newEdges)
      } catch {
        // Network error — canvas stays empty
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [direction, setNodes, setEdges])

  // Handle node changes (drag, select, etc.)
  const onNodesChange: OnNodesChange<AgentNode> = useCallback(
    (changes) => {
      const updated = applyNodeChanges(changes, nodes)
      setNodes(updated as AgentNode[])
    },
    [nodes, setNodes]
  )

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      const updated = applyEdgeChanges(changes, edges)
      setEdges(updated as AgentEdge[])
    },
    [edges, setEdges]
  )

  // Persist position after drag
  const onNodeDragStop: NodeMouseHandler<AgentNode> = useCallback(
    (_event, node) => {
      const agentId = parseInt(node.id.replace('agent-', ''))
      if (isNaN(agentId)) return

      // Update local cache
      useCanvasStore.getState().updateNodePosition(node.id, node.position)

      // Persist to server
      fetch('/api/spatial/positions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions: [{ agent_id: agentId, x: node.position.x, y: node.position.y }] }),
      }).catch(() => {
        // Silent fail — position will be re-fetched on next load
      })
    },
    []
  )

  // Click node → show detail sidebar
  const onNodeClick: NodeMouseHandler<AgentNode> = useCallback(
    async (_event, node) => {
      const agentId = parseInt(node.id.replace('agent-', ''))
      if (isNaN(agentId)) return

      try {
        const res = await fetch(`/api/agents/${agentId}`)
        if (res.ok) {
          const data = await res.json()
          setSelectedAgentDetail(data.agent || data)
        }
      } catch {
        // Silent fail
      }
    },
    []
  )

  // Re-run dagre layout
  const handleAutoLayout = useCallback(() => {
    const { nodes: layoutNodes } = applyDagreLayout(nodes, edges, { direction })
    setNodes(layoutNodes)

    // Persist all new positions
    const positions = layoutNodes.map((n) => ({
      agent_id: parseInt(n.id.replace('agent-', '')),
      x: n.position.x,
      y: n.position.y,
    })).filter((p) => !isNaN(p.agent_id))

    if (positions.length > 0) {
      fetch('/api/spatial/positions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions }),
      }).catch(() => {})
    }
  }, [nodes, edges, direction, setNodes])

  return (
    <div className="h-full w-full flex flex-col pt-14 md:pt-0">
      {/* Header */}
      <div className="h-14 border-b border-border/40 bg-card/40 backdrop-blur-xl flex items-center justify-between px-6 shrink-0 z-10">
        <div>
          <h1 className="font-bold text-lg leading-tight">Agent Topology</h1>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
            {nodes.length} agents, {edges.length} relationships
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDirection((d) => (d === 'TB' ? 'LR' : 'TB'))}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
          >
            {direction === 'TB' ? 'Top-Down' : 'Left-Right'}
          </button>
          <button
            onClick={handleAutoLayout}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            Auto Layout
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative bg-background/20">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            nodeTypes={agentNodeTypes}
            edgeTypes={agentEdgeTypes}
            nodesConnectable={false}
            minZoom={0.1}
            maxZoom={2}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={2} color="var(--primary)" className="opacity-20" />
            <Controls className="bg-card border-border rounded-xl overflow-hidden shadow-xl" />
            <MiniMap
              className="bg-card border-border rounded-xl shadow-xl overflow-hidden"
              nodeColor={(n) => (n.type === 'team' ? 'var(--primary)' : 'var(--muted)')}
              maskColor="var(--background)"
            />
          </ReactFlow>
        )}
      </div>

      {/* Agent Detail Sidebar */}
      {selectedAgentDetail && (
        <AgentDetailSidebar agent={selectedAgentDetail} onClose={() => setSelectedAgentDetail(null)} />
      )}
    </div>
  )
}

function AgentDetailSidebar({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-card border-l border-border shadow-2xl z-50 overflow-y-auto">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="font-bold text-lg truncate">{agent.name}</h2>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">x</button>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Status</div>
          <div className="font-medium">{agent.status}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Role</div>
          <div className="font-medium">{agent.role}</div>
        </div>
        {agent.last_seen && (
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Last Seen</div>
            <div className="font-medium text-sm">{new Date(agent.last_seen * 1000).toLocaleString()}</div>
          </div>
        )}
        {agent.last_activity && (
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Last Activity</div>
            <div className="font-medium text-sm">{agent.last_activity}</div>
          </div>
        )}
        {agent.taskStats && (
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Tasks</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>Total: {agent.taskStats.total}</div>
              <div>In Progress: {agent.taskStats.in_progress}</div>
              <div>Done: {agent.taskStats.done}</div>
              <div>Assigned: {agent.taskStats.assigned}</div>
            </div>
          </div>
        )}
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Created</div>
          <div className="font-medium text-sm">{new Date(agent.created_at * 1000).toLocaleString()}</div>
        </div>
      </div>
    </div>
  )
}
