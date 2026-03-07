'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button } from '@/components/ui/button'

interface AgentFileInfo {
  path: string
  chunks: number
  textSize: number
}

interface AgentGraphData {
  name: string
  dbSize: number
  totalChunks: number
  totalFiles: number
  files: AgentFileInfo[]
}

// --- Custom node components ---

function AgentHubNode({ data }: NodeProps & { data: Record<string, unknown> }) {
  const name = (data.name as string) || ''
  const totalChunks = (data.totalChunks as number) || 0
  const totalFiles = (data.totalFiles as number) || 0
  const dbSize = (data.dbSize as number) || 0
  const color = (data.color as string) || 'var(--void-cyan)'
  const isSelected = data.isSelected as boolean

  const sizeLabel = dbSize > 1024 * 1024
    ? `${(dbSize / (1024 * 1024)).toFixed(0)}M`
    : `${(dbSize / 1024).toFixed(0)}K`

  const radius = Math.max(40, Math.min(70, 30 + Math.sqrt(totalChunks) * 2))

  return (
    <div
      className="flex items-center justify-center cursor-pointer"
      style={{ width: radius * 2, height: radius * 2 }}
    >
      <div
        className={`rounded-full flex flex-col items-center justify-center border-2 transition-all ${
          isSelected ? 'shadow-[0_0_20px_rgba(0,255,255,0.4)]' : ''
        }`}
        style={{
          width: radius * 2,
          height: radius * 2,
          borderColor: `hsl(${color})`,
          background: `hsl(${color} / 0.1)`,
        }}
      >
        <span
          className="font-mono text-xs font-bold tracking-wide"
          style={{ color: `hsl(${color})` }}
        >
          {name}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono mt-0.5">
          {totalChunks} chunks
        </span>
        <span className="text-[9px] text-muted-foreground/60 font-mono">
          {totalFiles} files / {sizeLabel}
        </span>
      </div>
    </div>
  )
}

function FileNode({ data }: NodeProps & { data: Record<string, unknown> }) {
  const filePath = (data.filePath as string) || ''
  const chunks = (data.chunks as number) || 0
  const color = (data.color as string) || 'var(--void-cyan)'
  const fileName = filePath.split('/').pop() || filePath

  return (
    <div
      className="void-panel px-2.5 py-1.5 border rounded-md min-w-[100px] max-w-[180px] cursor-pointer"
      style={{ borderColor: `hsl(${color} / 0.5)` }}
    >
      <div className="flex items-center gap-1.5">
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: `hsl(${color})` }}
        />
        <span className="text-xs text-foreground truncate font-mono" title={filePath}>
          {fileName}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground font-mono mt-0.5 pl-3.5">
        {chunks} chunks
      </div>
    </div>
  )
}

const nodeTypes = {
  agentHub: AgentHubNode,
  fileNode: FileNode,
}

// Color palette for agents
const AGENT_COLORS = [
  'var(--void-cyan)',
  'var(--void-amber)',
  'var(--void-violet)',
  'var(--void-mint)',
  'var(--void-crimson)',
  '210 80% 60%',
  '330 70% 60%',
  '160 60% 50%',
  '50 80% 55%',
  '270 60% 60%',
  '0 70% 60%',
  '190 70% 55%',
  '140 50% 50%',
  '30 80% 55%',
  '300 50% 55%',
  '220 60% 55%',
  '80 60% 50%',
]

function getFileColor(filePath: string): string {
  if (filePath.startsWith('sessions/') || filePath.includes('/sessions/')) return 'var(--void-cyan)'
  if (filePath.startsWith('memory/') || filePath.includes('/memory/')) return 'var(--void-mint)'
  if (filePath.startsWith('knowledge') || filePath.includes('/knowledge')) return '240 60% 65%'
  if (filePath.endsWith('.md')) return 'var(--void-amber)'
  if (filePath.endsWith('.json') || filePath.endsWith('.jsonl')) return 'var(--void-violet)'
  return '210 50% 55%'
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function MemoryGraph() {
  const [agents, setAgents] = useState<AgentGraphData[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFile, setSelectedFile] = useState<AgentFileInfo | null>(null)

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  // Fetch graph data
  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/memory/graph?agent=all')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setAgents(data.agents || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Build graph nodes/edges
  const { graphNodes, graphEdges } = useMemo(() => {
    if (!agents.length) return { graphNodes: [], graphEdges: [] }

    const gNodes: Node[] = []
    const gEdges: Edge[] = []

    if (selectedAgent === 'all') {
      // All-agents overview: radial layout of agent hubs
      const total = agents.length
      const radius = Math.min(400, 100 + total * 25)

      agents.forEach((agent, i) => {
        const angle = (i / total) * 2 * Math.PI - Math.PI / 2
        const color = AGENT_COLORS[i % AGENT_COLORS.length]

        gNodes.push({
          id: `agent-${agent.name}`,
          type: 'agentHub',
          position: {
            x: 500 + Math.cos(angle) * radius,
            y: 400 + Math.sin(angle) * radius,
          },
          data: {
            name: agent.name,
            totalChunks: agent.totalChunks,
            totalFiles: agent.totalFiles,
            dbSize: agent.dbSize,
            color,
            isSelected: false,
            label: agent.name,
          },
        })
      })
    } else {
      // Single-agent view: hub at center, files radially around it
      const agent = agents.find((a) => a.name === selectedAgent)
      if (!agent) return { graphNodes: [], graphEdges: [] }

      const agentIdx = agents.indexOf(agent)
      const agentColor = AGENT_COLORS[agentIdx % AGENT_COLORS.length]

      // Hub node at center
      gNodes.push({
        id: `agent-${agent.name}`,
        type: 'agentHub',
        position: { x: 400, y: 350 },
        data: {
          name: agent.name,
          totalChunks: agent.totalChunks,
          totalFiles: agent.totalFiles,
          dbSize: agent.dbSize,
          color: agentColor,
          isSelected: true,
          label: agent.name,
        },
      })

      // Filter and sort files
      let files = agent.files
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        files = files.filter((f) => f.path.toLowerCase().includes(q))
      }

      // Limit displayed files for performance
      const maxFiles = 60
      const displayFiles = files.slice(0, maxFiles)
      const total = displayFiles.length
      const fileRadius = Math.min(500, 150 + total * 8)

      displayFiles.forEach((file, i) => {
        const angle = (i / total) * 2 * Math.PI - Math.PI / 2
        const color = getFileColor(file.path)

        const nodeId = `file-${i}`
        gNodes.push({
          id: nodeId,
          type: 'fileNode',
          position: {
            x: 400 + Math.cos(angle) * fileRadius,
            y: 350 + Math.sin(angle) * fileRadius,
          },
          data: {
            filePath: file.path,
            chunks: file.chunks,
            textSize: file.textSize,
            color,
            label: file.path,
          },
        })

        gEdges.push({
          id: `edge-${agent.name}-${i}`,
          source: `agent-${agent.name}`,
          target: nodeId,
          style: {
            stroke: `hsl(${color} / 0.3)`,
            strokeWidth: 1,
          },
          type: 'smoothstep',
        })
      })
    }

    return { graphNodes: gNodes, graphEdges: gEdges }
  }, [agents, selectedAgent, searchQuery])

  useEffect(() => {
    setNodes(graphNodes)
    setEdges(graphEdges)
  }, [graphNodes, graphEdges, setNodes, setEdges])

  // Handle node click
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === 'agentHub' && selectedAgent === 'all') {
        const name = node.data.name as string
        setSelectedAgent(name)
        setSelectedFile(null)
        setSearchQuery('')
      } else if (node.type === 'fileNode') {
        const filePath = node.data.filePath as string
        const agent = agents.find((a) => a.name === selectedAgent)
        const file = agent?.files.find((f) => f.path === filePath)
        if (file) setSelectedFile(file)
      }
    },
    [selectedAgent, agents]
  )

  // Stats
  const stats = useMemo(() => {
    const totalAgents = agents.length
    const totalFiles = agents.reduce((s, a) => s + a.totalFiles, 0)
    const totalChunks = agents.reduce((s, a) => s + a.totalChunks, 0)
    const totalSize = agents.reduce((s, a) => s + a.dbSize, 0)
    return { totalAgents, totalFiles, totalChunks, totalSize }
  }, [agents])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        <span className="ml-3 text-muted-foreground">Loading memory graph...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <span className="text-red-400 mb-2">Failed to load memory graph</span>
        <span className="text-sm">{error}</span>
        <Button onClick={fetchData} className="mt-4" variant="secondary" size="sm">
          Retry
        </Button>
      </div>
    )
  }

  if (!agents.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <span>No memory databases found</span>
        <span className="text-xs mt-1">OpenClaw memory SQLite files not detected</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground font-mono">AGENT:</label>
          <select
            value={selectedAgent}
            onChange={(e) => {
              setSelectedAgent(e.target.value)
              setSelectedFile(null)
              setSearchQuery('')
            }}
            className="px-2 py-1 text-sm bg-surface-1 border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="all">All Agents ({stats.totalAgents})</option>
            {agents.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name} ({a.totalChunks} chunks)
              </option>
            ))}
          </select>
        </div>

        {selectedAgent !== 'all' && (
          <>
            <Button
              onClick={() => {
                setSelectedAgent('all')
                setSelectedFile(null)
                setSearchQuery('')
              }}
              variant="secondary"
              size="sm"
            >
              Back to Overview
            </Button>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter files..."
              className="px-2 py-1 text-sm bg-surface-1 border border-border rounded-md text-foreground placeholder-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 w-48"
            />
          </>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-surface-1 border border-border rounded-md px-3 py-2">
          <div className="text-lg font-bold text-foreground font-mono">{stats.totalAgents}</div>
          <div className="text-xs text-muted-foreground">Agents</div>
        </div>
        <div className="bg-surface-1 border border-border rounded-md px-3 py-2">
          <div className="text-lg font-bold text-foreground font-mono">{stats.totalFiles.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Source Files</div>
        </div>
        <div className="bg-surface-1 border border-border rounded-md px-3 py-2">
          <div className="text-lg font-bold text-foreground font-mono">{stats.totalChunks.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Total Chunks</div>
        </div>
        <div className="bg-surface-1 border border-border rounded-md px-3 py-2">
          <div className="text-lg font-bold text-foreground font-mono">{formatBytes(stats.totalSize)}</div>
          <div className="text-xs text-muted-foreground">DB Size</div>
        </div>
      </div>

      {/* Graph canvas */}
      <div className="border border-border rounded-lg overflow-hidden" style={{ height: '500px' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          className="bg-transparent"
          minZoom={0.2}
          maxZoom={2}
        >
          <Controls
            style={{
              background: 'hsl(var(--surface-1))',
              border: '1px solid hsl(var(--surface-3))',
              borderRadius: '10px',
            }}
          />
          <Background
            variant={BackgroundVariant.Dots}
            gap={40}
            size={0.6}
            color="hsl(var(--void-cyan) / 0.08)"
          />
        </ReactFlow>
      </div>

      {/* Selected file detail */}
      {selectedFile && (
        <div className="bg-surface-1 border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-foreground font-mono">{selectedFile.path}</h3>
            <Button onClick={() => setSelectedFile(null)} variant="ghost" size="sm">
              Close
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Chunks:</span>{' '}
              <span className="text-foreground font-mono">{selectedFile.chunks}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Text Size:</span>{' '}
              <span className="text-foreground font-mono">{formatBytes(selectedFile.textSize)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
