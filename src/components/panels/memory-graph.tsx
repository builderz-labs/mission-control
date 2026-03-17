'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { GraphCanvas, GraphCanvasRef, type Theme, type GraphNode as ReagraphNode, type GraphEdge as ReagraphEdge, type InternalGraphNode } from 'reagraph'
import { useMissionControl } from '@/store'

// --- Data interfaces (match API response) ---

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

// --- Obsidian-inspired palette (muted purples, warm grays) ---

const AGENT_COLORS = [
  '#b4befe', // lavender
  '#cba6f7', // mauve
  '#f5c2e7', // pink
  '#89b4fa', // blue
  '#74c7ec', // sapphire
  '#89dceb', // sky
  '#94e2d5', // teal
  '#a6e3a1', // green
  '#f9e2af', // yellow
  '#fab387', // peach
  '#eba0ac', // maroon
  '#f38ba8', // red
  '#cdd6f4', // text
  '#bac2de', // subtext1
  '#a6adc8', // subtext0
  '#b4befe', // lavender2
  '#cba6f7', // mauve2
]

function getFileColor(filePath: string): string {
  if (filePath.startsWith('sessions/') || filePath.includes('/sessions/')) return '#89dceb'
  if (filePath.startsWith('memory/') || filePath.includes('/memory/')) return '#94e2d5'
  if (filePath.startsWith('knowledge') || filePath.includes('/knowledge')) return '#b4befe'
  if (filePath.endsWith('.md')) return '#f9e2af'
  if (filePath.endsWith('.json') || filePath.endsWith('.jsonl')) return '#cba6f7'
  return '#89b4fa'
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// --- Obsidian graph theme ---

const obsidianTheme: Theme = {
  canvas: {
    background: '#11111b',
    fog: '#11111b',
  },
  node: {
    fill: '#6c7086',
    activeFill: '#cba6f7',
    opacity: 1,
    selectedOpacity: 1,
    inactiveOpacity: 0.1,
    label: {
      color: '#cdd6f4',
      stroke: '#11111b',
      activeColor: '#f5f5f7',
    },
  },
  ring: {
    fill: '#6c7086',
    activeFill: '#cba6f7',
  },
  edge: {
    fill: '#45475a',
    activeFill: '#cba6f7',
    opacity: 0.15,
    selectedOpacity: 0.5,
    inactiveOpacity: 0.03,
    label: {
      color: '#6c7086',
      activeColor: '#cdd6f4',
    },
  },
  arrow: {
    fill: '#45475a',
    activeFill: '#cba6f7',
  },
  lasso: {
    background: 'rgba(203, 166, 247, 0.08)',
    border: 'rgba(203, 166, 247, 0.25)',
  },
}

// --- Component ---

export function MemoryGraph() {
  const t = useTranslations('memoryGraph')
  const { memoryGraphAgents, setMemoryGraphAgents } = useMissionControl()
  const agents = memoryGraphAgents || []
  const [selectedAgent, setSelectedAgent] = useState<string>('all')
  const [isLoading, setIsLoading] = useState(memoryGraphAgents === null)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFile, setSelectedFile] = useState<AgentFileInfo | null>(null)
  const [actives, setActives] = useState<string[]>([])
  const [hoveredNode, setHoveredNode] = useState<{ label: string; sub?: string } | null>(null)

  const graphRef = useRef<GraphCanvasRef | null>(null)

  // Fetch data
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
      setMemoryGraphAgents(data.agents || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setIsLoading(false)
    }
  }, [setMemoryGraphAgents])

  useEffect(() => {
    if (memoryGraphAgents !== null) return
    fetchData()
  }, [fetchData, memoryGraphAgents])

  // Stats
  const stats = useMemo(() => {
    const totalAgents = agents.length
    const totalFiles = agents.reduce((s, a) => s + a.totalFiles, 0)
    const totalChunks = agents.reduce((s, a) => s + a.totalChunks, 0)
    const totalSize = agents.reduce((s, a) => s + a.dbSize, 0)
    return { totalAgents, totalFiles, totalChunks, totalSize }
  }, [agents])

  // Build reagraph nodes/edges from API data
  const { graphNodes, graphEdges } = useMemo(() => {
    if (!agents.length) return { graphNodes: [], graphEdges: [] }

    const nodes: ReagraphNode[] = []
    const edges: ReagraphEdge[] = []

    if (selectedAgent === 'all') {
      agents.forEach((agent, i) => {
        const color = AGENT_COLORS[i % AGENT_COLORS.length]
        const hubSize = Math.max(5, Math.min(15, 4 + Math.sqrt(agent.totalChunks) * 0.8))

        nodes.push({
          id: `hub-${agent.name}`,
          label: agent.name,
          fill: color,
          size: hubSize,
        })

        const maxFiles = 25
        const files = agent.files.slice(0, maxFiles)
        files.forEach((file, fi) => {
          const fileSize = Math.max(1.5, Math.min(5, 1 + Math.sqrt(file.chunks) * 0.6))
          const fileColor = getFileColor(file.path)
          const nodeId = `file-${agent.name}-${fi}`

          nodes.push({
            id: nodeId,
            label: '',
            fill: fileColor,
            size: fileSize,
            data: { filePath: file.path, chunks: file.chunks, textSize: file.textSize, agentName: agent.name },
          })

          edges.push({
            id: `edge-hub-${agent.name}-${nodeId}`,
            source: `hub-${agent.name}`,
            target: nodeId,
            fill: color,
          })
        })
      })
    } else {
      const agent = agents.find((a) => a.name === selectedAgent)
      if (!agent) return { graphNodes: [], graphEdges: [] }

      const agentIdx = agents.indexOf(agent)
      const color = AGENT_COLORS[agentIdx % AGENT_COLORS.length]
      const hubSize = Math.max(6, Math.min(18, 5 + Math.sqrt(agent.totalChunks) * 0.8))

      nodes.push({
        id: `hub-${agent.name}`,
        label: agent.name,
        fill: color,
        size: hubSize,
      })

      let files = agent.files
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        files = files.filter((f) => f.path.toLowerCase().includes(q))
      }

      const maxFiles = 120
      const displayFiles = files.slice(0, maxFiles)

      displayFiles.forEach((file, fi) => {
        const fileSize = Math.max(2, Math.min(8, 2 + Math.sqrt(file.chunks) * 0.8))
        const fileColor = getFileColor(file.path)
        const nodeId = `file-${agent.name}-${fi}`

        nodes.push({
          id: nodeId,
          label: file.path.split('/').pop() || file.path,
          fill: fileColor,
          size: fileSize,
          data: { filePath: file.path, chunks: file.chunks, textSize: file.textSize, agentName: agent.name },
        })

        edges.push({
          id: `edge-hub-${agent.name}-${nodeId}`,
          source: `hub-${agent.name}`,
          target: nodeId,
          fill: color,
        })
      })

      // Weak inter-file edges for same-directory clustering
      const dirMap = new Map<string, string[]>()
      displayFiles.forEach((file, fi) => {
        const dir = file.path.split('/').slice(0, -1).join('/')
        if (!dir) return
        const nodeId = `file-${agent.name}-${fi}`
        if (!dirMap.has(dir)) dirMap.set(dir, [])
        dirMap.get(dir)!.push(nodeId)
      })
      for (const ids of dirMap.values()) {
        for (let i = 0; i < ids.length - 1 && i < 5; i++) {
          edges.push({
            id: `edge-dir-${ids[i]}-${ids[i + 1]}`,
            source: ids[i],
            target: ids[i + 1],
          })
        }
      }
    }

    return { graphNodes: nodes, graphEdges: edges }
  }, [agents, selectedAgent, searchQuery])

  // Auto-fit the graph after layout settles (nodes change)
  useEffect(() => {
    if (!graphNodes.length) return
    // reagraph force layout needs time to settle before fitNodesInView works
    const t1 = setTimeout(() => graphRef.current?.fitNodesInView(undefined, { animated: false }), 800)
    const t2 = setTimeout(() => graphRef.current?.fitNodesInView(undefined, { animated: false }), 2500)
    const t3 = setTimeout(() => graphRef.current?.fitNodesInView(undefined, { animated: false }), 5000)
    const t4 = setTimeout(() => graphRef.current?.fitNodesInView(undefined, { animated: false }), 8000)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4) }
  }, [graphNodes.length, selectedAgent])

  // Navigation helpers
  const goBack = useCallback(() => {
    setSelectedAgent('all')
    setSelectedFile(null)
    setSearchQuery('')
    setActives([])
    setHoveredNode(null)
  }, [])

  const drillInto = useCallback((agentName: string) => {
    setSelectedAgent(agentName)
    setSelectedFile(null)
    setSearchQuery('')
    setActives([])
    setHoveredNode(null)
  }, [])

  // Interaction handlers
  const handleNodeClick = useCallback((node: InternalGraphNode) => {
    const id = node.id
    if (id.startsWith('hub-') && selectedAgent === 'all') {
      drillInto(id.replace('hub-', ''))
    } else if (id.startsWith('hub-') && selectedAgent !== 'all') {
      // clicking the hub in drilled-in view goes back
      goBack()
    } else if (id.startsWith('file-') && node.data) {
      const { filePath, chunks, textSize } = node.data as { filePath: string; chunks: number; textSize: number }
      setSelectedFile({ path: filePath, chunks, textSize })
    }
  }, [selectedAgent, drillInto, goBack])

  const handleNodeHover = useCallback((node: InternalGraphNode) => {
    setActives([node.id])
    if (node.data) {
      const d = node.data as { filePath: string; chunks: number; textSize: number; agentName: string }
      setHoveredNode({ label: d.filePath, sub: `${d.chunks} chunks / ${formatBytes(d.textSize)}` })
    } else if (node.id.startsWith('hub-')) {
      const name = node.id.replace('hub-', '')
      const agent = agents.find(a => a.name === name)
      if (agent) {
        setHoveredNode({ label: agent.name, sub: `${agent.totalChunks} chunks / ${agent.totalFiles} files / ${formatBytes(agent.dbSize)}` })
      }
    }
  }, [agents])

  const handleNodeUnhover = useCallback(() => {
    setActives([])
    setHoveredNode(null)
  }, [])

  const handleCanvasClick = useCallback(() => {
    setActives([])
    setSelectedFile(null)
    setHoveredNode(null)
  }, [])

  // --- Render ---

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: '#11111b' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[#cba6f7]/30 border-t-[#cba6f7] animate-spin" />
          <span className="text-[#6c7086] text-sm font-mono">{t('loading')}</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ background: '#11111b' }}>
        <span className="text-[#f38ba8] text-sm">{error}</span>
        <button onClick={fetchData} className="px-3 py-1.5 text-xs rounded-md bg-[#1e1e2e] border border-[#45475a] text-[#cdd6f4] hover:border-[#cba6f7]/50 transition-colors">
          {t('retry')}
        </button>
      </div>
    )
  }

  if (!agents.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2" style={{ background: '#11111b' }}>
        <span className="text-[#6c7086] text-sm">{t('noMemoryDatabases')}</span>
        <span className="text-[#45475a] text-xs">{t('noMemoryDatabasesHint')}</span>
      </div>
    )
  }

  const activeAgent = selectedAgent !== 'all' ? agents.find(a => a.name === selectedAgent) : null

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: '#11111b' }}>
      {/* Full-bleed graph canvas */}
      <GraphCanvas
        ref={graphRef}
        nodes={graphNodes}
        edges={graphEdges}
        theme={obsidianTheme}
        layoutType="forceDirected2d"
        layoutOverrides={{
          linkDistance: selectedAgent === 'all' ? 80 : 100,
          nodeStrength: selectedAgent === 'all' ? -60 : -80,
        }}
        labelType={selectedAgent === 'all' ? 'auto' : 'auto'}
        edgeArrowPosition="none"
        animated={true}
        draggable={true}
        defaultNodeSize={4}
        minNodeSize={1.5}
        maxNodeSize={15}
        cameraMode="pan"
        actives={actives}
        onNodeClick={handleNodeClick}
        onNodePointerOver={handleNodeHover}
        onNodePointerOut={handleNodeUnhover}
        onCanvasClick={handleCanvasClick}
      />

      {/* Floating breadcrumb / navigation bar (top-left) */}
      <div className="absolute top-3 left-3 flex items-center gap-1.5 z-10">
        <button
          onClick={goBack}
          className={`px-2.5 py-1 text-[11px] font-mono rounded-md backdrop-blur-xl transition-all ${
            selectedAgent === 'all'
              ? 'bg-[#cba6f7]/15 text-[#cba6f7] border border-[#cba6f7]/25'
              : 'bg-[#1e1e2e]/80 text-[#6c7086] border border-[#45475a]/50 hover:text-[#cdd6f4] hover:border-[#cba6f7]/30'
          }`}
        >
          {t('allAgents')}
        </button>
        {activeAgent && (
          <>
            <span className="text-[#45475a] text-[10px]">/</span>
            <span className="px-2.5 py-1 text-[11px] font-mono rounded-md bg-[#cba6f7]/15 text-[#cba6f7] border border-[#cba6f7]/25">
              {activeAgent.name}
            </span>
          </>
        )}
      </div>

      {/* Floating stats (top-right) */}
      <div className="absolute top-3 right-3 flex items-center gap-3 z-10">
        {selectedAgent !== 'all' && (
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('filterFiles')}
            className="px-2.5 py-1 text-[11px] font-mono rounded-md bg-[#1e1e2e]/80 backdrop-blur-xl border border-[#45475a]/50 text-[#cdd6f4] placeholder-[#45475a] focus:outline-none focus:border-[#cba6f7]/40 w-36 transition-colors"
          />
        )}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#1e1e2e]/80 backdrop-blur-xl border border-[#45475a]/30">
          <StatChip label={t('statAgents')} value={stats.totalAgents} />
          <Sep />
          <StatChip label={t('statFiles')} value={stats.totalFiles} />
          <Sep />
          <StatChip label={t('statChunks')} value={stats.totalChunks} />
          <Sep />
          <StatChip label={t('statSize')} value={formatBytes(stats.totalSize)} />
        </div>
      </div>

      {/* Hover tooltip (bottom-center) */}
      {hoveredNode && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="px-3 py-2 rounded-lg bg-[#1e1e2e]/90 backdrop-blur-xl border border-[#45475a]/40 shadow-2xl shadow-black/40 max-w-md">
            <div className="text-[11px] font-mono text-[#cdd6f4] truncate">{hoveredNode.label}</div>
            {hoveredNode.sub && (
              <div className="text-[10px] font-mono text-[#6c7086] mt-0.5">{hoveredNode.sub}</div>
            )}
          </div>
        </div>
      )}

      {/* Selected file detail panel (bottom-left) */}
      {selectedFile && (
        <div className="absolute bottom-3 left-3 z-10 max-w-sm">
          <div className="px-4 py-3 rounded-lg bg-[#1e1e2e]/90 backdrop-blur-xl border border-[#45475a]/40 shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between gap-4 mb-2">
              <h3 className="text-[11px] font-mono text-[#cdd6f4] truncate">{selectedFile.path}</h3>
              <button
                onClick={() => setSelectedFile(null)}
                className="text-[#6c7086] hover:text-[#cdd6f4] text-xs transition-colors shrink-0"
              >
                x
              </button>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-mono text-[#6c7086]">
              <span><span className="text-[#cba6f7]">{selectedFile.chunks}</span> {t('chunks')}</span>
              <span><span className="text-[#89b4fa]">{formatBytes(selectedFile.textSize)}</span> {t('text')}</span>
            </div>
          </div>
        </div>
      )}

      {/* Color legend (bottom-right) */}
      <div className="absolute bottom-3 right-3 z-10">
        <div className="px-3 py-2 rounded-lg bg-[#1e1e2e]/80 backdrop-blur-xl border border-[#45475a]/30">
          <div className="flex items-center gap-3 text-[9px] font-mono text-[#585b70]">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#89dceb]" />{t('legendSessions')}</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#94e2d5]" />{t('legendMemory')}</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#b4befe]" />{t('legendKnowledge')}</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#f9e2af]" />.md</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#cba6f7]" />.json</span>
          </div>
        </div>
      </div>

      {/* Keyboard hint */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 text-[9px] font-mono text-[#313244] pointer-events-none select-none">
        {t('keyboardHint')}
      </div>
    </div>
  )
}

function StatChip({ label, value }: { label: string; value: number | string }) {
  const display = typeof value === 'number' ? value.toLocaleString() : value
  return (
    <span className="text-[10px] font-mono">
      <span className="text-[#cdd6f4]">{display}</span>
      <span className="text-[#585b70] ml-1">{label}</span>
    </span>
  )
}

function Sep() {
  return <span className="text-[#313244]">|</span>
}
