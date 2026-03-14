'use client'

import { X, ShieldCheck, Zap, Code2, Clock, Terminal, Activity, FileText, Loader2, AlertCircle, BarChart3, Rocket } from 'lucide-react'
import { Session } from '@/types'
import { cn } from '@/lib/utils'
import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface IntelligenceModalProps {
  session: Session
  onClose: () => void
}

export function IntelligenceModal({ session, onClose }: IntelligenceModalProps) {
  const [debrief, setDebrief] = useState<string | null>(null)
  const [loadingDebrief, setLoadingDebrief] = useState(false)
  const [remediation, setRemediation] = useState<{ action: string; priority: string; rationale: string } | null>(null)
  const [executing, setExecuting] = useState(false)

  useEffect(() => {
    if (!session) return
    async function fetchData() {
      setLoadingDebrief(true)
      try {
        const debriefRes = await fetch(`/api/sessions/${session.session_id}/debrief`)
        if (debriefRes.ok) {
          const data = await debriefRes.json()
          setDebrief(data.markdown)
        }

        const remediationRes = await fetch(`/api/sessions/${session.session_id}/remediation`)
        if (remediationRes.ok) {
          const data = await remediationRes.json()
          setRemediation(data)
        }
      } catch {
        // Session intelligence fetch is optional — degrade gracefully
      } finally {
        setLoadingDebrief(false)
      }
    }
    fetchData()
  }, [session])

  if (!session) return null;

  // Parse loc_by_language if it's a string
  const locByLang = typeof session.loc_by_language === 'string'
    ? JSON.parse(session.loc_by_language)
    : (session.locByLanguage || {})

  const handleIntervention = async () => {
    if (!remediation || remediation.action === 'NONE') return
    setExecuting(true)
    try {
      const res = await fetch(`/api/sessions/${session.session_id}/intervene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: remediation.action })
      })
      const data = await res.json()
      if (res.ok) {
        alert(`Aegis Intervention Successful: ${data.message}`)
      } else {
        alert(`Intervention Failed: ${data.message}`)
      }
    } catch {
      // Intervention failure handled by UI state
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
      <div 
        className="bg-[#020617] w-full max-w-2xl border border-white/10 shadow-2xl rounded-[1.5rem] overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-8 border-b border-border/60 flex items-start justify-between bg-secondary/20">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10">
                <Terminal className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-black uppercase italic tracking-tight">Session Intelligence</h2>
            </div>
            <p className="text-xs text-muted-foreground font-mono">{session.session_id}</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-full transition-colors group"
          >
            <X className="w-5 h-5 text-muted-foreground group-hover:text-foreground" />
          </button>
        </div>

        {session.is_anomaly && (
          <div className="bg-red-500/10 border-b border-red-500/20 px-8 py-2 flex items-center justify-between animate-pulse">
            <div className="flex items-center gap-2 text-red-500 text-[10px] font-black uppercase tracking-[0.2em]">
              <AlertCircle className="w-4 h-4" />
              Sovereignty Warning: Predictive Anomaly Detected
            </div>
            <span className="text-[8px] font-mono text-red-500/60 uppercase">Stability Variance &gt; 20%</span>
          </div>
        )}

        {remediation && remediation.action !== 'NONE' && (
          <div className="bg-primary/10 border-b border-primary/20 px-8 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-primary text-[10px] font-black uppercase tracking-[0.2em]">
              <Zap className="w-4 h-4" />
              Aegis Strategy Pulse: {remediation.action} Suggested
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-mono text-primary/60 uppercase">Priority: {remediation.priority}</span>
              <button 
                onClick={handleIntervention}
                disabled={executing}
                className="px-3 py-1 bg-primary text-black text-[8px] font-black uppercase rounded hover:opacity-80 transition-all disabled:opacity-50"
              >
                {executing ? 'Executing...' : 'Execute Intervention'}
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-8 space-y-8">
          {/* Top Grid Metrics */}
          <div className="grid grid-cols-2 gap-4">
            {remediation && remediation.action !== 'NONE' ? (
              <div className="col-span-2 bg-primary/5 p-4 rounded-3xl border border-primary/20 space-y-2 animate-in slide-in-from-top-2 duration-500">
                <div className="flex items-center gap-2 text-primary">
                  <Rocket className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Autonomous Intervention Recommended</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-black text-white italic">{remediation.action} : {remediation.priority.toUpperCase()} PRIORITY</span>
                  <p className="text-[10px] text-muted-foreground italic leading-relaxed">
                    {remediation.rationale}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="bg-secondary/30 p-4 rounded-3xl border border-border/40 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="text-[10px] font-black uppercase tracking-widest">Stability Score</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className={cn(
                  "text-3xl font-black italic tracking-tighter",
                  (session.stability_score ?? 0) >= 90 ? "text-green-500" :
                  (session.stability_score ?? 0) >= 70 ? "text-amber-500" : "text-red-500"
                )}>
                  {Math.round(session.stability_score ?? 0)}%
                </span>
                <span className="text-[10px] font-bold text-muted-foreground uppercase">{session.tool_error_count} Errors</span>
              </div>
            </div>

            <div className="bg-secondary/30 p-4 rounded-3xl border border-border/40 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-widest">Strategic Alignment</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-black text-white uppercase italic truncate">
                  {session.area || 'CORE'} : {session.intent_task || 'Orchestration'}
                </span>
                <span className="text-[9px] text-muted-foreground font-mono uppercase tracking-widest">Outcome Optimization</span>
              </div>
            </div>
          </div>

          {/* Language Breakdown */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-black uppercase italic tracking-widest">Language Breakdown</h3>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {Object.entries(locByLang).length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No code changes detected in this session.</p>
              ) : (
                Object.entries(locByLang).map(([lang, loc]) => (
                  <div key={lang} className="flex items-center gap-4">
                    <div className="w-16 text-[10px] font-black uppercase tracking-widest text-muted-foreground">{lang}</div>
                    <div className="flex-1 h-2 bg-secondary/50 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary/60 group-hover:bg-primary transition-colors" 
                        style={{ width: `${Math.min(100, (Number(loc) / (session.tool_uses || 1)) * 100)}%` }}
                      ></div>
                    </div>
                    <div className="w-12 text-right text-[10px] font-bold tracking-tighter italic">+{loc as number}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Tool Execution Stream (Phase 7) */}
          <div className="space-y-4 pt-4 border-t border-border/40">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-black uppercase italic tracking-widest">Tool Execution Stream</h3>
            </div>
            <div className="relative pl-4 space-y-4 border-l border-border/40 ml-2">
              {Array.isArray(session.tool_timeline) || (typeof session.tool_timeline === 'string' && session.tool_timeline !== '[]') ? (
                (() => {
                  const timeline = typeof session.tool_timeline === 'string' 
                    ? JSON.parse(session.tool_timeline) 
                    : (session.tool_timeline || [])
                  
                  return timeline.slice(-12).map((event: any, i: number) => {
                    // Logic for "Cognitive Weight" (time since last event)
                    const prevEvent = timeline[timeline.indexOf(event) - 1]
                    const duration = prevEvent 
                      ? (new Date(event.timestamp).getTime() - new Date(prevEvent.timestamp).getTime()) / 1000
                      : 0
                    
                    // High-LoC Impact Marker (Heuristic: Edit/Write tools often imply impact)
                    const hasImpact = ['Edit', 'Write', 'multi_replace_file_content', 'replace_file_content'].includes(event.name)

                    return (
                      <div key={i} className="relative flex items-center gap-3 group/item">
                        <div className={cn(
                          "absolute -left-[21px] w-2.5 h-2.5 rounded-full border-2 border-card z-10",
                          event.status === 'success' ? "bg-green-500" : "bg-red-500",
                          hasImpact && "ring-4 ring-primary/20"
                        )}></div>
                        
                        <div className={cn(
                          "bg-secondary/20 px-3 py-2 rounded-xl border border-border/20 flex-1 flex items-center justify-between group-hover/item:border-primary/40 transition-colors",
                          hasImpact && "border-primary/30 bg-primary/5"
                        )}>
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                              {event.name}
                              {hasImpact && <ShieldCheck className="w-2.5 h-2.5 text-primary" />}
                            </span>
                            {duration > 5 && (
                              <span className="text-[8px] font-bold text-muted-foreground/60 uppercase">
                                Cognitive Burden: {duration.toFixed(1)}s
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-mono opacity-40 uppercase">
                            {new Date(event.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    )
                  })
                })()
              ) : (
                <p className="text-xs text-muted-foreground italic">No tool execution events recorded.</p>
              )}
            </div>
          </div>

          {/* Context Snippet */}
          <div className="space-y-4 pt-4 border-t border-border/40">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              <span className="text-[10px] font-black uppercase tracking-widest italic">Last Interaction Context</span>
            </div>
            <div className="bg-secondary/10 p-4 rounded-2xl border border-border/20">
              <p className="text-xs leading-relaxed text-muted-foreground/90 italic">
                {session.last_user_prompt ? `"${session.last_user_prompt}"` : "No recent prompt history recorded."}
              </p>
            </div>
          </div>

          {/* Mission Debrief (Phase 8) */}
          <div className="space-y-4 pt-4 border-t border-border/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-black uppercase italic tracking-widest">Aegis Mission Debrief</h3>
              </div>
              {loadingDebrief && <Loader2 className="w-4 h-4 animate-spin text-primary/40" />}
            </div>
            
            <div className="bg-secondary/20 p-6 rounded-3xl border border-primary/10 prose prose-invert prose-xs max-w-none">
              {debrief ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {debrief}
                </ReactMarkdown>
              ) : loadingDebrief ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3 opacity-40">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">Compiling Intelligence...</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No debrief available for this session.</p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 bg-secondary/10 border-t border-border/60 flex justify-end">
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-foreground text-background font-black uppercase tracking-widest rounded-full text-[10px] hover:opacity-90 active:scale-95 transition-all"
          >
            Acknowledge
          </button>
        </div>
      </div>
    </div>
  )
}
