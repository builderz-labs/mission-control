'use client'

import { Share2, Terminal, ArrowRight, ShieldCheck, AlertTriangle, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConnectionNode {
  id: string
  label: string
  model: string
  status: 'nominal' | 'warning' | 'critical'
  intentTask?: string | null
  isLocked?: boolean
  children: ConnectionNode[]
}

interface ConnectivityGraphProps {
  sessions: any[]
  activeLocks?: any[]
  onClose: () => void
}

export function ConnectivityGraph({ sessions, activeLocks = [], onClose }: ConnectivityGraphProps) {
  // Simple hierarchy builder based on parent_session_id or proximity
  const buildHierarchy = () => {
    const nodes: Record<string, ConnectionNode> = {}
    const roots: ConnectionNode[] = []

    // Phase 1: Create all nodes
    sessions.forEach(s => {
      nodes[s.session_id] = {
        id: s.session_id,
        label: s.project_slug || 'Unknown Agent',
        model: s.model || 'Unknown',
        status: s.alert_status || 'nominal',
        intentTask: s.intent_task || null,
        isLocked: activeLocks.some((l: any) => l.session_id === s.session_id),
        children: []
      }
    })

    // Phase 2: Connect nodes
    sessions.forEach(s => {
      if (s.parent_session_id && nodes[s.parent_session_id]) {
        nodes[s.parent_session_id].children.push(nodes[s.session_id])
      } else if (!s.is_sidechain) {
        roots.push(nodes[s.session_id])
      }
    })

    return roots
  }

  const roots = buildHierarchy()

  return (
    <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-xl flex items-center justify-center p-4 md:p-8 animate-in fade-in zoom-in duration-300">
      <div className="bg-card/90 border border-primary/20 w-full max-w-5xl h-[80vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary/40 to-transparent"></div>
        
        {/* Header */}
        <div className="p-8 border-b border-border/40 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20">
              <Share2 className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-black uppercase italic tracking-tighter">Fleet Connectivity</h2>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Agent Hierarchy & Subagent Mapping</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-3 rounded-2xl bg-secondary/50 hover:bg-primary hover:text-primary-foreground transition-all group"
          >
            <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>

        {/* Graph Area */}
        <div className="flex-1 overflow-auto p-8 custom-scrollbar">
          <div className="inline-flex flex-col gap-12 min-w-full">
            {roots.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-20 text-muted-foreground italic">
                <Activity className="w-12 h-12 mb-4 opacity-20" />
                <p>No active agent connectivity detected.</p>
              </div>
            ) : (
              roots.map(root => (
                <TreeNode key={root.id} node={root} level={0} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function TreeNode({ node, level }: { node: ConnectionNode, level: number }) {
  return (
    <div className="space-y-8">
      <div className={cn(
        "relative flex items-center gap-4 p-4 rounded-2xl border bg-card/40 transition-all hover:bg-card/60 group w-fit min-w-[300px]",
        node.status === 'critical' ? "border-red-500/50 shadow-[0_0_15px_-5px_rgba(239,68,68,0.3)]" :
        node.status === 'warning' ? "border-amber-500/50" : "border-border/60",
        node.isLocked && "border-primary/50 shadow-[0_0_20px_-5px_rgba(var(--primary),0.4)] ring-1 ring-primary/20"
      )}>
        <div className={cn(
          "p-2.5 rounded-xl bg-secondary/50 relative",
          node.status === 'critical' ? "text-red-500" :
          node.status === 'warning' ? "text-amber-500" : "text-primary"
        )}>
          <Terminal className="w-5 h-5" />
          {node.isLocked && (
            <div className="absolute -top-1 -right-1 p-1 bg-primary rounded-full text-black">
              <ShieldCheck className="w-2 h-2" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-black uppercase italic tracking-tighter truncate">{node.label}</h4>
            {node.status === 'critical' && <AlertTriangle className="w-3 h-3 text-red-500" />}
          </div>
          <p className="text-[10px] font-mono opacity-50 uppercase truncate">{node.model}</p>
        </div>
        <div className="flex items-center gap-2 pr-2">
           <ShieldCheck className={cn(
             "w-4 h-4",
             node.status === 'critical' ? "text-red-500" :
             node.status === 'warning' ? "text-amber-500" : "text-green-500"
           )} />
        </div>

        {/* Intent Handoff (Phase 8) */}
        {node.intentTask && (
          <div className="absolute -top-6 left-12 right-0 flex items-center gap-2">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent"></div>
            <div className="px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 backdrop-blur-md">
              <span className="text-[8px] font-black italic text-primary uppercase tracking-tighter">
                Intent: {node.intentTask}
              </span>
            </div>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent"></div>
          </div>
        )}
      </div>

      {node.children.length > 0 && (
        <div className="relative pl-12 space-y-8 border-l-2 border-primary/10 ml-8">
          {node.children.map(child => (
            <TreeNode key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
