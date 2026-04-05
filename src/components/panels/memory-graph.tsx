'use client'

import { getErrorMessage } from '@/lib/types/sql'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  GraphCanvas, GraphCanvasRef,
  type Theme, type GraphNode as ReagraphNode,
  type GraphEdge as ReagraphEdge, type InternalGraphNode,
} from 'reagraph'
import { useMissionControl } from '@/store'
import {
  type AgentFileInfo, type AgentGraphData,
  AGENT_COLORS, getFileColor, formatBytes,
} from './memory-graph-types'
import {
  BreadcrumbNav, StatsBar, HoverTooltip,
  SelectedFilePanel, ColorLegend,
} from './memory-graph-overlays'

// Obsidian graph theme — muted purples on dark background
const obsidianTheme: Theme = {
  canvas: { background: '#11111b', fog: '#11111b' },
  node: {
    fill: '#6c7086',
    activeFill: '#cba6f7',
    opacity: 1,
    selectedOpacity: 1,
    inactiveOpacity: 0.1,
    label: { color: '#cdd6f4', stroke: '#11111b', activeColor: '#f5f5f7' },
  },
  ring: { fill: '#6c7086', activeFill: '#cba6f7' },
  edge: {
    fill: '#45475a',
    activeFill: '#cba6f7',
    opacity: 0.15,
    selectedOpacity: 0.5,
    inactiveOpacity: 0.03,
    label: { color: '#6c7086', activeColor: '#cdd6f4' },
  },
  arrow: { fill: '#45475a', activeFill: '#cba6f7' },
  lasso: { background: 'rgba(203, 166, 247, 0.08)', border: 'rgba(203, 166, 247, 0.25)' },
}

export function MemoryGraph(): React.JSX.Element {
  const t = useTranslations('memoryGraph')
  const { memoryGraphAgents, setMemoryGraphAgents } = useMissionControl()
  const agents: AgentGraphData[] = memoryGraphAgents || []
  const [selectedAgent, setSelectedAgent] = useState<string>('all')
  const [isLoading, setIsLoading] = useState(memoryGraphAgents === null)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFile, setSelectedFile] = useState<AgentFileInfo | null>(null)
  const [actives, setActives] = useState<string[]>([])
  const [hoveredNode, setHoveredNode] = useState<{ label: string; sub?: string } | null>(null)
  const graphRef = useRef<GraphCanvasRef | null>(null)

  const fetchData = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/memory/graph?agent=all', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setMemoryGraphAgents(data.agents || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? getErrorMessage(err) : 'Failed to load')
    } finally {
      setIsLoading(false)
    }
  }, [setMemoryGraphAgents])

  useEffect(() => {
    if (memoryGraphAgents !== null) return
    fetchData()
  }, [fetchData, memoryGraphAgents])

  const stats = useMemo(() => ({
    totalAgents: agents.length,
    totalFiles: agents.reduce((s, a) => s + a.totalFiles, 0),
    totalChunks: agents.reduce((s, a) => s + a.totalChunks, 0),
    totalSize: agents.reduce((s, a) => s + a.dbSize, 0),
  }), [agents])

  const { graphNodes, graphEdges } = useMemo((): { graphNodes: ReagraphNode[]; graphEdges: ReagraphEdge[] } => {
    if (!agents.length) return { graphNodes: [], graphEdges: [] }
    const nodes: ReagraphNode[] = []
    const edges: ReagraphEdge[] = []

    if (selectedAgent === 'all') {
      agents.forEach((agent, i) => {
        const color = AGENT_COLORS[i % AGENT_COLORS.length]
        const hubSize = Math.max(5, Math.min(15, 4 + Math.sqrt(agent.totalChunks) * 0.8))
        nodes.push({ id: `hub-${agent.name}`, label: agent.name, fill: color, size: hubSize })
        agent.files.slice(0, 25).forEach((file, fi) => {
          const nodeId = `file-${agent.name}-${fi}`
          nodes.push({
            id: nodeId, label: '',
            fill: getFileColor(file.path),
            size: Math.max(1.5, Math.min(5, 1 + Math.sqrt(file.chunks) * 0.6)),
            data: { filePath: file.path, chunks: file.chunks, textSize: file.textSize, agentName: agent.name },
          })
          edges.push({ id: `edge-hub-${agent.name}-${nodeId}`, source: `hub-${agent.name}`, target: nodeId, fill: color })
        })
      })
    } else {
      const agent = agents.find((a) => a.name === selectedAgent)
      if (!agent) return { graphNodes: [], graphEdges: [] }
      const agentIdx = agents.indexOf(agent)
      const color = AGENT_COLORS[agentIdx % AGENT_COLORS.length]
      const hubSize = Math.max(6, Math.min(18, 5 + Math.sqrt(agent.totalChunks) * 0.8))
      nodes.push({ id: `hub-${agent.name}`, label: agent.name, fill: color, size: hubSize })

      let files = agent.files
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        files = files.filter((f) => f.path.toLowerCase().includes(q))
      }
      const displayFiles = files.slice(0, 120)
      displayFiles.forEach((file, fi) => {
        const nodeId = `file-${agent.name}-${fi}`
        nodes.push({
          id: nodeId,
          label: file.path.split('/').pop() || file.path,
          fill: getFileColor(file.path),
          size: Math.max(2, Math.min(8, 2 + Math.sqrt(file.chunks) * 0.8)),
          data: { filePath: file.path, chunks: file.chunks, textSize: file.textSize, agentName: agent.name },
        })
        edges.push({ id: `edge-hub-${agent.name}-${nodeId}`, source: `hub-${agent.name}`, target: nodeId, fill: color })
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
          edges.push({ id: `edge-dir-${ids[i]}-${ids[i + 1]}`, source: ids[i], target: ids[i + 1] })
        }
      }
    }
    return { graphNodes: nodes, graphEdges: edges }
  }, [agents, selectedAgent, searchQuery])

  // Auto-fit after layout settles — multiple checkpoints because force layout is async
  useEffect(() => {
    if (!graphNodes.length) return
    const t1 = setTimeout(() => graphRef.current?.fitNodesInView(undefined, { animated: false }), 800)
    const t2 = setTimeout(() => graphRef.current?.fitNodesInView(undefined, { animated: false }), 2500)
    const t3 = setTimeout(() => graphRef.current?.fitNodesInView(undefined, { animated: false }), 5000)
    const t4 = setTimeout(() => graphRef.current?.fitNodesInView(undefined, { animated: false }), 8000)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4) }
  }, [graphNodes.length, selectedAgent])

  const goBack = useCallback((): void => {
    setSelectedAgent('all')
    setSelectedFile(null)
    setSearchQuery('')
    setActives([])
    setHoveredNode(null)
  }, [])

  const drillInto = useCallback((agentName: string): void => {
    setSelectedAgent(agentName)
    setSelectedFile(null)
    setSearchQuery('')
    setActives([])
    setHoveredNode(null)
  }, [])

  const handleNodeClick = useCallback((node: InternalGraphNode): void => {
    const id = node.id
    if (id.startsWith('hub-') && selectedAgent === 'all') {
      drillInto(id.replace('hub-', ''))
    } else if (id.startsWith('hub-') && selectedAgent !== 'all') {
      goBack()
    } else if (id.startsWith('file-') && node.data) {
      const { filePath, chunks, textSize } = node.data as { filePath: string; chunks: number; textSize: number }
      setSelectedFile({ path: filePath, chunks, textSize })
    }
  }, [selectedAgent, drillInto, goBack])

  const handleNodeHover = useCallback((node: InternalGraphNode): void => {
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

  const handleNodeUnhover = useCallback((): void => {
    setActives([])
    setHoveredNode(null)
  }, [])

  const handleCanvasClick = useCallback((): void => {
    setActives([])
    setSelectedFile(null)
    setHoveredNode(null)
  }, [])

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
        <button
          onClick={fetchData}
          className="px-3 py-1.5 text-xs rounded-md bg-[#1e1e2e] border border-[#45475a] text-[#cdd6f4] hover:border-[#cba6f7]/50 transition-colors"
        >
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

  const activeAgent = selectedAgent !== 'all' ? agents.find(a => a.name === selectedAgent) ?? null : null

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: '#11111b' }}>
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
        labelType="auto"
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

      <BreadcrumbNav selectedAgent={selectedAgent} activeAgent={activeAgent} onGoBack={goBack} />
      <StatsBar selectedAgent={selectedAgent} searchQuery={searchQuery} stats={stats} onSearchChange={setSearchQuery} />
      <HoverTooltip node={hoveredNode} />
      <SelectedFilePanel file={selectedFile} onClose={() => setSelectedFile(null)} />
      <ColorLegend />

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 text-[9px] font-mono text-[#313244] pointer-events-none select-none">
        {t('keyboardHint')}
      </div>
    </div>
  )
}
