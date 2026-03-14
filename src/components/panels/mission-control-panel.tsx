'use client'

import { useEffect, useState } from 'react'
import { 
  Activity, CheckCircle2, Clock, LayoutDashboard, Rocket, Zap, 
  ChevronRight, GitBranch, GitCommit, Code2, AlertCircle, 
  Terminal, BarChart3, ShieldCheck, GitPullRequest, Search,
  Share2, ArrowRight, LucideIcon
} from 'lucide-react'
import { IntelligenceModal } from '@/components/dashboard/intelligence-modal'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('MissionControlPanel')
import { ConnectivityGraph } from '@/components/dashboard/connectivity-graph'
import { config } from '@/lib/config'
import { cn } from '@/lib/utils'

interface GitHealth {
  branch: string | null
  commitHash: string | null
  isDirty: boolean
  aheadBy: number
  behindBy: number
  untrackedCount: number
  stagedCount: number
  lastCommitAt: number | null
}

import { Session, ProjectHealth } from '@/types'

interface MissionStats {
  total_loc: number
  total_successes: number
  total_errors: number
  total_cost: number
}

interface BurnForecast {
  todayActual: number
  todayProjected: number
  velocity: number
}

export function MissionControlPanel() {
  const [data, setData] = useState<{
    projects: ProjectHealth[],
    activeSessions: Session[],
    stats: MissionStats,
    burnForecast?: BurnForecast,
    sovereignty?: {
      status: 'nominal' | 'breached'
      violations: any[]
    },
    swarm?: {
      member_count: number
      active_locks: any[]
    },
    cluster?: {
      status: string
      node_id: string
      peers: any[]
    }
  } | null>(null)
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning' | 'nominal'>('all')
  const [search, setSearch] = useState('')
  const [showGraph, setShowGraph] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchData = async () => {
    try {
      const [healthRes, swarmRes] = await Promise.all([
        fetch('/api/mission-health'),
        fetch('/api/swarm/status')
      ])
      
      if (healthRes.ok && swarmRes.ok) {
        const health = await healthRes.json()
        const swarm = await swarmRes.json()
        setData({ ...health, swarm })
      }
    } catch (err) {
      log.error({ err }, 'Failed to fetch mission health')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 15000) // Faster refresh for "Live" feel
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center animate-pulse">
            <Rocket className="w-6 h-6 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground animate-pulse font-black uppercase tracking-widest italic">Syncing Intelligence Stream...</p>
        </div>
      </div>
    )
  }

  const totalLoc = data?.stats?.total_loc || 0
  const successRate = data?.stats?.total_successes
    ? Math.round((data.stats.total_successes / (data.stats.total_successes + (data.stats.total_errors || 0))) * 100)
    : 0

  return (
    <div className="flex flex-col h-full bg-[#020617] text-white">
      {/* V12: Consolidated Hybrid Header (56px Target) */}
      <header className="h-14 shrink-0 border-b border-white/5 bg-background/80 backdrop-blur-xl flex items-center px-4 justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Rocket className="w-4 h-4 text-primary" />
            <h1 className="text-sm font-black uppercase tracking-[0.2em] italic font-mono">Mission Control <span className="text-secondary-foreground/40 font-normal ml-2">V12.0</span></h1>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-4 text-[10px] font-mono text-secondary-foreground/60 uppercase tracking-widest">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
              </span>
              <span>Gateway: Online</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-8">
          <div className="flex items-center gap-6 text-[10px] font-mono">
            <div className="flex flex-col items-end">
              <span className="text-secondary-foreground/30 text-[9px] uppercase tracking-tighter">Delta Cluster</span>
              <span className="text-primary font-black">+{totalLoc.toLocaleString()} LoC</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-secondary-foreground/30 text-[9px] uppercase tracking-tighter">Fleet Status</span>
              <span className="text-white font-black">{data?.activeSessions.length || 0} ACTIVE</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-secondary-foreground/30 text-[9px] uppercase tracking-tighter">Sovereignty</span>
              <span className={cn(
                "font-black flex items-center gap-1.5", 
                data?.sovereignty?.status === 'breached' ? "text-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "text-green-500"
              )}>
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  data?.sovereignty?.status === 'breached' ? "bg-red-500 animate-pulse" : "bg-green-500"
                )} />
                {data?.sovereignty?.status?.toUpperCase() || 'NOMINAL'}
              </span>
            </div>
            <div className="flex flex-col items-end border-l border-white/5 pl-4">
              <span className="text-secondary-foreground/30 text-[9px] uppercase tracking-tighter">Swarm Mesh</span>
              <span className="text-primary font-black flex items-center gap-1.5 italic">
                <Share2 className="w-3 h-3 animate-pulse" />
                {data?.swarm?.member_count || 0} NODES
              </span>
            </div>
            <div className="flex flex-col items-end border-l border-white/5 pl-4">
              <span className="text-secondary-foreground/30 text-[9px] uppercase tracking-tighter">Cluster Synthesis</span>
              <span className="text-[#a855f7] font-black flex items-center gap-1.5 italic">
                <LayoutDashboard className="w-3 h-3 animate-pulse" />
                {((data?.cluster?.peers?.length || 0) + 1)} ACTIVE
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn(
              "h-8 px-3 rounded-md flex items-center gap-2 font-mono text-[10px] font-black border transition-all",
              (data?.burnForecast?.velocity || 0) > (data?.burnForecast?.todayProjected || 1) / 24 
                ? "bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse" 
                : "bg-white/5 text-primary border-white/10"
            )}>
              <Zap className="w-3 h-3" />
              {(data?.burnForecast?.velocity || 0).toFixed(3)}/HR
            </div>
            <button
              onClick={() => setShowGraph(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary/80 hover:bg-primary hover:text-primary-foreground transition-all border border-border/40 text-[10px] font-black uppercase tracking-widest font-mono"
            >
              <Share2 className="w-3.5 h-3.5" />
              Graph
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="max-w-[1700px] mx-auto p-4 space-y-4">
          
          {/* Main Content Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            
            {/* Agent Fleet (Left Column - 8/12) */}
            <div className="lg:col-span-8 flex flex-col gap-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2 text-secondary-foreground/40">
                  <Terminal className="w-3.5 h-3.5" />
                  <h2 className="text-[10px] font-black uppercase tracking-[0.2em] font-mono">Live Session Feed</h2>
                </div>
                {data?.burnForecast && (
                  <div className="flex items-center gap-3 bg-white/5 border border-white/10 px-3 py-1 rounded-md">
                    <span className="text-[9px] text-primary font-black font-mono">BURN: ${data.burnForecast.velocity.toFixed(3)}/HR</span>
                    <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary"
                        style={{ width: `${Math.min(100, (data.burnForecast.todayActual / data.burnForecast.todayProjected) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {/* V13: ATF (Advanced Tactical Filter) Strip */}
                <div className="flex items-center gap-2 h-8 px-2 bg-white/[0.02] border border-white/5 rounded-md">
                  <Search className="w-3 h-3 text-secondary-foreground/20" />
                  <input 
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="FILTER SESSIONS..."
                    className="flex-1 bg-transparent border-none outline-none text-[9px] font-mono font-black uppercase tracking-widest placeholder:text-secondary-foreground/10"
                  />
                  <div className="flex items-center gap-1">
                    {(['all', 'critical', 'warning', 'nominal'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={cn(
                          "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter transition-all border",
                          filter === f 
                            ? "bg-primary text-black border-primary" 
                            : "bg-white/5 text-secondary-foreground/40 border-white/5 hover:border-white/10"
                        )}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* V12: Compact Session List */}
              <div className="flex flex-col gap-1">
                {(() => {
                  const filtered = (data?.activeSessions || []).filter(s => {
                    const matchesFilter = filter === 'all' || s.alert_status === filter
                    const matchesSearch = !search || 
                      s.project_slug.toLowerCase().includes(search.toLowerCase()) ||
                      s.model.toLowerCase().includes(search.toLowerCase())
                    return matchesFilter && matchesSearch
                  })

                  if (filtered.length === 0) {
                    return (
                      <div className="border border-dashed border-white/5 p-8 rounded-md flex flex-col items-center justify-center text-center">
                        <Activity className="w-6 h-6 text-white/10 mb-2" />
                        <p className="text-[10px] text-white/30 uppercase tracking-[0.2em]">No Matches Found</p>
                      </div>
                    )
                  }

                  return filtered.map((session: Session) => (
                    <div 
                      key={session.session_id}
                      onClick={() => setSelectedSession(session)}
                      className={cn(
                        "group flex items-center gap-4 bg-white/[0.02] border-b border-white/[0.04] hover:bg-white/[0.05] p-2.5 transition-all cursor-pointer rounded-[4px]",
                        session.alert_status === 'critical' && "border-l-2 border-l-red-500 bg-red-500/5",
                        session.alert_status === 'warning' && "border-l-2 border-l-amber-500 bg-amber-500/5"
                      )}
                    >
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0 relative",
                        session.alert_status === 'critical' ? "bg-red-500" :
                        session.alert_status === 'warning' ? "bg-amber-500" : "bg-primary"
                      )}>
                        {session.is_anomaly && (
                          <span className="absolute inset-x-[-4px] inset-y-[-4px] border border-red-500 rounded-full animate-ping opacity-75" />
                        )}
                      </div>
                      
                      <div className="w-32 shrink-0">
                        <span className="text-[11px] font-bold text-white group-hover:text-primary transition-colors truncate block">
                          {session.project_slug}
                        </span>
                        {session.area && session.area !== 'unknown' && (
                          <span className={cn(
                            "text-[7px] font-black uppercase px-1 rounded border",
                            session.area === 'frontend' ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                            session.area === 'backend' ? "bg-purple-500/10 text-purple-400 border-purple-500/20" :
                            "bg-orange-500/10 text-orange-400 border-orange-500/20"
                          )}>
                            {session.area}
                          </span>
                        )}
                      </div>

                      <div className="w-24 shrink-0 text-[10px] font-mono text-secondary-foreground/40 uppercase tracking-tighter truncate">
                        {session.model.split('/').pop()}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-secondary-foreground/60 truncate italic">
                          &ldquo;{session.last_user_prompt || 'Idle...'}&rdquo;
                        </p>
                      </div>

                      <div className="flex items-center gap-4 shrink-0 font-mono text-[10px]">
                        <div className="flex items-center gap-1.5">
                          <span className="text-secondary-foreground/30">LoC</span>
                          <span className="text-primary font-black">+{session.total_loc_delta}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <ShieldCheck className="w-3 h-3 text-secondary-foreground/20" />
                          <span className={cn(
                            "font-black",
                            session.stability_score >= 90 ? "text-green-500" :
                            session.stability_score >= 70 ? "text-amber-500" : "text-red-500"
                          )}>
                            {Math.round(session.stability_score)}%
                          </span>
                        </div>
                        <div className="text-secondary-foreground/20 italic">
                          {new Date(session.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  ))
                })()}
              </div>
            </div>

            {/* Mission Nodes (Right Column - 4/12) */}
            <div className="lg:col-span-4 space-y-4">
              <div className="flex items-center gap-2 px-2 text-secondary-foreground/40">
                <LayoutDashboard className="w-3.5 h-3.5" />
                <h2 className="text-[10px] font-black uppercase tracking-[0.2em] font-mono">Infrastructure Nodes</h2>
              </div>

              <div className="flex flex-col gap-2">
                {data?.projects.map((project: ProjectHealth) => (
                  <div key={project.name} className="bg-white/[0.02] border border-white/5 rounded-[4px] p-3 space-y-3 hover:border-white/10 transition-all group">
                    <div className="flex items-start justify-between">
                      <div className="space-y-0.5">
                        <h3 
                          className="text-xs font-black text-white group-hover:text-primary transition-colors flex items-center justify-between"
                          data-project-node={project.name.toLowerCase()}
                        >
                          {project.name}
                          {project.activeSessionCount !== undefined && project.activeSessionCount > 0 && (
                            <span className="flex items-center gap-1 text-[9px] text-primary">
                              <Rocket className="w-2.5 h-2.5" />
                              {project.activeSessionCount}
                            </span>
                          )}
                        </h3>
                        <div className="flex items-center gap-2 text-[9px] font-mono text-secondary-foreground/40">
                          <GitBranch className="w-3 h-3" />
                          {project.git?.branch || 'master'}
                        </div>
                        {project.roadmapFocus && (
                          <div className="flex items-center gap-2 text-[9px] font-mono text-primary/60 italic uppercase tracking-widest">
                            <Zap className="w-2.5 h-2.5" />
                            {project.roadmapFocus}
                          </div>
                        )}
                      </div>
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[8px] font-mono font-black uppercase tracking-tighter border",
                        project.git?.isDirty ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-green-500/10 text-green-500 border-green-500/20"
                      )}>
                        {project.git?.isDirty ? 'Dirty' : 'Clean'}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[9px] font-mono text-secondary-foreground/40 uppercase">
                        <span>Sync Progress</span>
                        <span className="text-white">{project.progress}%</span>
                      </div>
                      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all duration-700"
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                    </div>

                    {project.roadmap && project.roadmap.length > 0 && (
                      <div className="space-y-1 bg-black/40 p-2 rounded border border-white/5">
                        <div className="flex items-center gap-1.5 text-[8px] font-black text-secondary-foreground/30 uppercase tracking-widest mb-1">
                          <BarChart3 className="w-2.5 h-2.5" />
                          Predictive Roadmap
                        </div>
                        {project.roadmap.map(phase => (
                          <div key={phase.name} className="space-y-0.5">
                            <div className="flex items-center justify-between text-[7px] font-mono">
                              <span className={cn(
                                phase.status === 'done' ? "text-green-500/60" :
                                phase.status === 'in_progress' ? "text-primary/60" : "text-secondary-foreground/20"
                              )}>
                                {phase.name.toUpperCase()}
                              </span>
                              <span className="text-[6px] opacity-40">{phase.progress}%</span>
                            </div>
                            <div className="h-0.5 bg-white/5 rounded-full overflow-hidden">
                              <div 
                                className={cn(
                                  "h-full transition-all duration-1000",
                                  phase.status === 'done' ? "bg-green-500/40" : "bg-primary/40"
                                )}
                                style={{ width: `${phase.progress}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 text-[9px] font-mono text-secondary-foreground/40">
                          <GitCommit className="w-3 h-3" />
                          {project.git?.commitHash?.slice(0, 7) || '---'}
                        </div>
                        <div className="flex items-center gap-1 text-[9px] font-mono text-secondary-foreground/40">
                          <Code2 className="w-3 h-3" />
                          {project.status.toUpperCase()}
                        </div>
                      </div>
                      <ChevronRight className="w-3 h-3 text-secondary-foreground/20 group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* V12 Footer: Minimal Telemetry Row */}
          <footer className="mt-8 border-t border-white/5 pt-4 flex flex-wrap gap-x-8 gap-y-2 items-center justify-center text-[9px] font-mono text-secondary-foreground/30 font-black uppercase tracking-[0.25em]">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-3 h-3 text-green-500/30" />
              INTEGRITY: NOMINAL
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-3 h-3 text-primary/30" />
              THROUGHPUT: 1.2 GB/S
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3 text-primary/30" />
              LAST_SYNC: {new Date().toLocaleTimeString()}
            </div>
            <div className="flex items-center gap-2">
              <Activity className="w-3 h-3 text-primary/30" />
              V12_CLEAN_ENGINE
            </div>
          </footer>
        </div>
      </div>

      {selectedSession && (
        <IntelligenceModal 
          session={selectedSession} 
          onClose={() => setSelectedSession(null)} 
        />
      )}
      
      {showGraph && data && (
        <ConnectivityGraph 
          sessions={data.activeSessions} 
          activeLocks={data.swarm?.active_locks}
          onClose={() => setShowGraph(false)} 
        />
      )}
    </div>
  )
}
