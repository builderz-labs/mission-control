'use client'

import { useState, useEffect, useCallback } from 'react'
import { ReactFlow, Background, Controls, MiniMap, Node, Edge, useNodesState, useEdgesState, BackgroundVariant } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Activity, Server, ShieldAlert, Cpu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('TopologyPanel')

// Custom Node for Cluster Peers
function ClusterNode({ data }: { data: any }) {
  return (
    <div className={cn(
      "px-4 py-3 rounded-2xl border-2 bg-card/80 backdrop-blur-md shadow-xl min-w-[200px]",
      data.status === 'online' ? "border-primary/50" : "border-red-500/50"
    )}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Server className={cn("w-4 h-4", data.status === 'online' ? "text-primary" : "text-red-500")} />
          <span className="font-bold tracking-tight">{data.label}</span>
        </div>
        <div className={cn("w-2 h-2 rounded-full", data.status === 'online' ? "bg-primary animate-pulse" : "bg-red-500")} />
      </div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-mono">
        {data.role || 'Worker Node'}
      </div>
    </div>
  )
}

// Custom Node for Active Agent Sessions
function AgentNode({ data }: { data: any }) {
  return (
    <div className={cn(
      "px-4 py-3 rounded-2xl border bg-secondary/80 backdrop-blur-md shadow-lg min-w-[180px]",
      data.hasIntervention ? "border-amber-500 ring-2 ring-amber-500/20" : "border-border/50"
    )}>
      <div className="flex items-center gap-2 mb-1">
        <Cpu className="w-4 h-4 text-primary" />
        <span className="font-semibold text-sm truncate">{data.label}</span>
      </div>
      <div className="text-[9px] text-muted-foreground uppercase truncate flex items-center justify-between">
        <span>{data.task}</span>
        {data.hasIntervention && <ShieldAlert className="w-3 h-3 text-amber-500" />}
      </div>
    </div>
  )
}

const nodeTypes = {
  cluster: ClusterNode,
  agent: AgentNode
}

export function TopologyPanel() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [loading, setLoading] = useState(true)

  const fetchTopology = useCallback(async () => {
    try {
      // Fetch Cluster Nodes
      const clusterRes = await fetch('/api/cluster/heartbeat')
      const clusterData = await clusterRes.json()
      
      // Fetch Active Sessions
      const sessionsRes = await fetch('/api/claude/sessions?limit=5')
      const sessionsData = await sessionsRes.json()

      const newNodes: Node[] = []
      const newEdges: Edge[] = []

      // Add Master Node
      const masterId = clusterData.node_id || 'master'
      newNodes.push({
        id: masterId,
        type: 'cluster',
        position: { x: 0, y: 0 },
        data: { label: 'AEGIS OVERLORD', status: 'online', role: 'Consensus Leader' }
      })

      // Add Peer Nodes
      clusterData.peers?.forEach((peer: any, i: number) => {
        newNodes.push({
          id: peer.node_id,
          type: 'cluster',
          position: { x: (i + 1) * 250, y: 150 },
          data: { label: `Peer ${peer.node_id}`, status: peer.status, role: 'Worker' }
        })
        newEdges.push({
          id: `e-${masterId}-${peer.node_id}`,
          source: masterId,
          target: peer.node_id,
          animated: true,
          style: { stroke: 'var(--primary)', strokeWidth: 2 }
        })
      })

      // Add Agent Session Nodes
      sessionsData.sessions?.forEach((session: any, i: number) => {
        const hasIntervention = session.alert_status === 'warning' || session.alert_status === 'critical'
        newNodes.push({
          id: session.session_id,
          type: 'agent',
          position: { x: (i - 1) * 220, y: 250 + (i % 2) * 50 },
          data: { 
            label: session.project_slug || 'Unknown Project', 
            task: session.intent_task || 'Idle',
            hasIntervention
          }
        })
        newEdges.push({
          id: `e-${masterId}-${session.session_id}`,
          source: masterId,
          target: session.session_id,
          animated: true,
          style: { stroke: hasIntervention ? 'var(--amber-500)' : 'var(--muted-foreground)' }
        })
      })

      setNodes(newNodes)
      setEdges(newEdges)
      setLoading(false)
    } catch (e) {
      log.error({ err: e }, 'Failed to fetch topology')
      setLoading(false)
    }
  }, [setNodes, setEdges])

  useEffect(() => {
    fetchTopology()
    const interval = setInterval(fetchTopology, 5000)
    return () => clearInterval(interval)
  }, [fetchTopology])

  return (
    <div className="h-full w-full flex flex-col pt-14 md:pt-0">
      <div className="h-16 border-b border-border/40 bg-card/40 backdrop-blur-xl flex items-center justify-between px-6 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight uppercase tracking-tighter italic">Cluster Topology</h1>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Interactive Mesh Visualization</p>
          </div>
        </div>
      </div>

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
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={2} color="var(--primary)" className="opacity-20" />
            <Controls className="bg-card border-border rounded-xl overflow-hidden shadow-xl" />
            <MiniMap 
              className="bg-card border-border rounded-xl shadow-xl overflow-hidden" 
              nodeColor={(n) => n.type === 'cluster' ? 'var(--primary)' : 'var(--muted)'}
              maskColor="var(--background)"
            />
          </ReactFlow>
        )}
      </div>
      
      {/* Playback Timeline (Placeholder) */}
      <div className="h-24 border-t border-border/40 bg-card/60 backdrop-blur-xl p-4 flex flex-col justify-center shrink-0">
         <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Intervention Playback</span>
            <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full">Live Sync</span>
         </div>
         <div className="w-full h-2 bg-secondary rounded-full overflow-hidden relative">
            <div className="absolute top-0 left-0 h-full w-1/3 bg-primary/50" />
            <div className="absolute top-0 left-1/3 w-3 h-3 -mt-0.5 rounded-full bg-primary shadow-[0_0_10px_var(--primary)] cursor-pointer" />
         </div>
      </div>
    </div>
  )
}
