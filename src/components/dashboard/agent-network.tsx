'use client'

import { useCallback, useEffect, useState, useMemo } from 'react'
import {
  ReactFlow,
  Node,
  Edge,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { Agent, Session } from '@/types'
import { sessionToAgent, generateNodePosition } from '@/lib/utils'

interface AgentNetworkProps {
  agents: Agent[]
  sessions: Session[]
}

// Custom node component for agents
function AgentNode({ data }: { data: any }) {
  const { agent, status } = data
  
  const getStatusColor = () => {
    switch (status) {
      case 'active': return 'border-green-500 bg-green-500/20'
      case 'idle': return 'border-yellow-500 bg-yellow-500/20'
      case 'error': return 'border-red-500 bg-red-500/20'
      default: return 'border-gray-500 bg-gray-500/20'
    }
  }

  const getTypeIcon = () => {
    switch (agent.type) {
      case 'main': return '👑'
      case 'subagent': return '🤖'
      case 'cron': return '⏰'
      case 'group': return '👥'
      default: return '📄'
    }
  }

  const getRoleBadge = () => {
    switch (agent.type) {
      case 'main': 
        return { label: 'LEAD', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' }
      case 'subagent': 
        return { label: 'WORKER', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' }
      case 'cron': 
        return { label: 'CRON', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' }
      default: 
        return { label: 'SYSTEM', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' }
    }
  }

  const roleBadge = getRoleBadge()
  const isWorking = status === 'active'

  return (
    <div className={`px-3 py-3 shadow-lg rounded-lg border-2 ${getStatusColor()} bg-background min-w-[140px]`}>
      <div className="flex items-start justify-between">
        <span className={`text-lg ${isWorking ? 'working-indicator' : ''}`}>
          {getTypeIcon()}
        </span>
        {isWorking && (
          <span className="px-1.5 py-0.5 text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30 rounded-full animate-pulse">
            WORKING
          </span>
        )}
      </div>
      
      <div className="mt-2">
        <div className="flex items-center space-x-1 mb-1">
          <div className="font-medium text-foreground text-sm truncate">
            {agent.name}
          </div>
          <span className={`px-1.5 py-0.5 text-xs font-bold border rounded-full ${roleBadge.color}`}>
            {roleBadge.label}
          </span>
        </div>
        
        <div className="text-xs text-muted-foreground truncate">
          {agent.model.split('/').pop()}
        </div>
        
        {agent.session && (
          <div className="text-xs text-muted-foreground/70 mt-1 truncate">
            {agent.session.key.split(':').pop()}
          </div>
        )}
      </div>
    </div>
  )
}

const nodeTypes = {
  agent: AgentNode,
}

export function AgentNetwork({ agents, sessions }: AgentNetworkProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  // Convert sessions to nodes and edges
  const { nodeData, edgeData } = useMemo(() => {
    const agentList = sessions.map(sessionToAgent)
    
    const nodes: Node[] = agentList.map((agent, index) => ({
      id: agent.id,
      type: 'agent',
      position: generateNodePosition(index, agentList.length),
      data: {
        agent,
        status: agent.status,
        label: agent.name
      },
      style: {
        background: 'transparent',
        border: 'none',
      }
    }))

    // Create edges based on relationships (main -> subagents, etc.)
    const edges: Edge[] = []
    const mainAgents = agentList.filter(a => a.type === 'main')
    const subagents = agentList.filter(a => a.type === 'subagent')
    const cronAgents = agentList.filter(a => a.type === 'cron')

    // Connect main agents to subagents
    mainAgents.forEach(main => {
      subagents.forEach(sub => {
        edges.push({
          id: `${main.id}-${sub.id}`,
          source: main.id,
          target: sub.id,
          animated: sub.status === 'active',
          style: {
            stroke: '#3b82f6',
            strokeWidth: 2,
          },
          type: 'smoothstep'
        })
      })

      // Connect main agents to cron jobs
      cronAgents.forEach(cron => {
        edges.push({
          id: `${main.id}-${cron.id}`,
          source: main.id,
          target: cron.id,
          animated: false,
          style: {
            stroke: '#6b7280',
            strokeWidth: 1,
            strokeDasharray: '5,5',
          },
          type: 'smoothstep'
        })
      })
    })

    return { nodeData: nodes, edgeData: edges }
  }, [sessions])

  useEffect(() => {
    setNodes(nodeData)
    setEdges(edgeData)
  }, [nodeData, edgeData, setNodes, setEdges])

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  )

  if (sessions.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border h-96 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <div className="text-4xl mb-2">🕸️</div>
          <p>No agent network to display</p>
          <p className="text-xs">Agent connections will appear here</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-lg border border-border">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold text-foreground">Agent Network</h3>
        <p className="text-sm text-muted-foreground">
          Visual representation of agent relationships
        </p>
      </div>
      
      <div className="h-96 bg-secondary/20">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          className="bg-secondary/10"
        >
          <Controls 
            style={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
            }}
          />
          <Background 
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="hsl(var(--muted-foreground))"
            style={{ opacity: 0.3 }}
          />
        </ReactFlow>
      </div>
    </div>
  )
}