'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Terminal, Send, ChevronUp, ChevronDown, Activity, ShieldAlert, Cpu } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CommandLog {
  type: 'input' | 'output' | 'error' | 'system'
  content: string
  timestamp: Date
}

export function CommandConsole() {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [logs, setLogs] = useState<CommandLog[]>([
    { type: 'system', content: 'AEGIS TACTICAL OVERLAY INITIALIZED: v1.0.4-STABLE', timestamp: new Date() },
    { type: 'system', content: 'READY FOR BROADCAST...', timestamp: new Date() }
  ])
  const [isExecuting, setIsExecuting] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  const addLog = (type: CommandLog['type'], content: string) => {
    setLogs(prev => [...prev.slice(-49), { type, content, timestamp: new Date() }])
  }

  const handleCommand = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isExecuting) return

    const fullCmd = input.trim()
    const [command, ...args] = fullCmd.slice(1).split(' ') // Remove the '/'

    if (!fullCmd.startsWith('/')) {
      addLog('error', 'INVALID PROTOCOL: COMMANDS MUST START WITH "/"')
      setInput('')
      return
    }

    addLog('input', fullCmd)
    setInput('')
    setIsExecuting(true)

    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, args })
      })

      const data = await res.json()

      if (res.ok) {
        addLog('output', `SUCCESS: ${data.message}`)
        if (data.data) {
          addLog('output', `DATA: ${JSON.stringify(data.data)}`)
        }
      } else {
        addLog('error', `FAULT: ${data.error || 'UNKNOWN REJECTION'}`)
      }
    } catch (err) {
      addLog('error', 'COMMUNICATION BREAKDOWN: FAILED TO REACH GATEWAY')
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <div className={cn(
      "fixed bottom-0 left-1/2 -translate-x-1/2 z-[80] w-[95vw] max-w-4xl transition-all duration-500 ease-aegis",
      isOpen ? "translate-y-0 h-80" : "translate-y-[calc(100%-48px)] h-48"
    )}>
      {/* Console Frame */}
      <div className="h-full glass-aegis border-x border-t hud-border rounded-t-3xl overflow-hidden shadow-[0_-10px_40px_-15px_rgba(34,211,238,0.2)] flex flex-col">
        {/* Toggle Bar */}
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="h-12 flex items-center justify-between px-6 bg-primary/5 hover:bg-primary/10 transition-colors group border-b border-primary/20"
        >
          <div className="flex items-center gap-3">
            <Terminal className={cn("w-4 h-4 text-primary", isOpen ? "animate-pulse" : "")} />
            <span className="text-[10px] font-black uppercase italic tracking-widest text-tactical">
              Tactical Command Surface <span className="text-secondary-foreground/40 ml-2 font-mono">[AEGIS-HUD-01]</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-2 pr-4 border-r border-primary/20">
                <Activity className="w-3 h-3 text-primary animate-pulse-aegis" />
                <span className="text-[8px] font-mono opacity-50 uppercase tracking-tighter italic">Broadcasting Active</span>
             </div>
            {isOpen ? <ChevronDown className="w-4 h-4 opacity-40" /> : <ChevronUp className="w-4 h-4 opacity-40 animate-bounce" />}
          </div>
        </button>

        {/* Scrollable Logs */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-auto p-4 space-y-1 font-mono text-[10px] custom-scrollbar selection:bg-primary/30"
        >
          <div className="absolute inset-0 pointer-events-none animate-scanline opacity-10 bg-gradient-to-b from-transparent via-primary/20 to-transparent h-24"></div>
          {logs.map((log, i) => (
            <div key={i} className={cn(
               "flex gap-3 px-2 py-0.5 rounded transition-colors hover:bg-white/5",
               log.type === 'error' ? "text-red-400" :
               log.type === 'output' ? "text-primary" :
               log.type === 'system' ? "text-amber-400" : "text-white/80"
            )}>
              <span className="opacity-30 shrink-0">[{log.timestamp.toLocaleTimeString([], { hour12: false })}]</span>
              <span className="shrink-0 font-bold uppercase italic tracking-tighter">
                {log.type === 'input' ? '>' : log.type === 'error' ? '!' : '#'}
              </span>
              <span className="whitespace-pre-wrap">{log.content}</span>
            </div>
          ))}
          {isExecuting && (
            <div className="flex gap-3 px-2 py-0.5 text-primary animate-pulse italic">
              <Activity className="w-3 h-3 animate-spin" />
              <span>TRANSMITTING COMMAND PACKETS...</span>
            </div>
          )}
        </div>

        {/* Command Input Area */}
        <form 
          onSubmit={handleCommand}
          className="p-4 bg-background/40 border-t border-primary/20 flex gap-4 items-center"
        >
          <div className="flex-1 relative group">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="ENTER BROADCAST PROTOCOL (E.G. /SYNC-PROJECTS, /KILL-ALL)..."
              className="w-full bg-primary/5 border border-primary/20 rounded-xl px-4 py-2 text-[10px] font-mono text-primary placeholder:text-primary/30 focus:outline-none focus:border-primary/50 focus:bg-primary/10 transition-all uppercase tracking-wider"
              disabled={isExecuting}
            />
            <div className="absolute inset-0 rounded-xl pointer-events-none border border-primary/0 group-focus-within:border-primary/40 transition-all"></div>
          </div>
          <button 
            type="submit"
            disabled={!input.trim() || isExecuting}
            className="p-2.5 rounded-xl bg-primary text-primary-foreground disabled:opacity-30 disabled:grayscale transition-all hover:scale-105 active:scale-95 shadow-lg shadow-primary/20"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        {/* Decorative HUD Elements */}
        <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-primary/40 rounded-tl-3xl pointer-events-none"></div>
        <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-primary/40 rounded-tr-3xl pointer-events-none"></div>
        <div className="absolute h-1 top-0 left-12 right-12 bg-primary/20 blur-sm pointer-events-none"></div>
      </div>
    </div>
  )
}
