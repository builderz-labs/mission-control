'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface AgentMessage {
  id: string
  agent: string
  message: string
  type: 'text' | 'tool' | 'document'
  thinking?: string
  timestamp: string
}

export function VirtualOfficePanel() {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [activeTyping, setActiveTyping] = useState<string | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Initial State fetch
    fetch('/api/virtual-office/chat')
      .then(res => res.json())
      .then(data => {
        if (data.chatHistory) setMessages(data.chatHistory)
      })

    // Subscribe to SSE stream
    const eventSource = new EventSource('/api/virtual-office/stream')

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data)
        if (parsed.type === 'message' && parsed.payload) {
          setMessages(prev => {
            // Check if we already have this message
            if (prev.some(m => m.id === parsed.payload.id)) return prev
            return [...prev, parsed.payload]
          })
        } else if (parsed.type === 'cleared') {
          setMessages([])
        }
      } catch (err) {
        // Ignored JSON parse errors
      }
    }

    eventSource.onerror = () => {
      // EventSource auto-reconnects, just close on unmount
    }

    return () => {
      eventSource.close()
    }
  }, [])

  // Auto-scroll
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight
    }
  }, [messages])

  const agents = [
    { name: 'Maestro', role: 'Architect', color: 'bg-purple-500', border: 'border-purple-500/20' },
    { name: 'AdForge', role: 'Marketing Engine', color: 'bg-cyan-500', border: 'border-cyan-500/20' },
    { name: 'JobForge', role: 'Talent Engine', color: 'bg-green-500', border: 'border-green-500/20' }
  ]

  return (
    <div className="flex flex-col h-full bg-background border border-border/50 rounded-lg overflow-hidden font-sans">
      
      {/* 2D Office Visualization Header */}
      <div className="p-4 border-b border-border/50 bg-secondary/20 flex justify-between items-center">
        <div className="flex gap-6">
          {agents.map(agent => {
            const isTyping = activeTyping === agent.name
            return (
              <div key={agent.name} className={`flex flex-col items-center gap-2 p-3 rounded-lg border ${agent.border} bg-background/50 relative overflow-hidden`}>
                 <div className={`absolute top-0 left-0 w-full h-0.5 ${agent.color}`} />
                 <div className="flex gap-3 items-center">
                    <div className="relative">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${agent.color}`}>
                        {agent.name.charAt(0)}
                      </div>
                      {isTyping && (
                         <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5">
                           <span className="flex h-3 w-3 relative">
                            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${agent.color}`}></span>
                            <span className={`relative inline-flex rounded-full h-3 w-3 ${agent.color}`}></span>
                          </span>
                         </div>
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-sm">{agent.name}</div>
                      <div className="text-xs text-muted-foreground">{agent.role}</div>
                    </div>
                 </div>
              </div>
            )
          })}
        </div>
        
        <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-black/40 border border-green-500/30">
           <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
           <span className="text-xs font-mono text-green-400">SYNC ACTIVE</span>
        </div>
      </div>

      {/* Chat / Thought Log */}
      <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
           <div className="h-full flex items-center justify-center text-muted-foreground/50 text-sm italic">
             Waiting for agents to initiate connection...
           </div>
        )}
        
        <AnimatePresence>
          {messages.map((msg, i) => {
            const agentProfile = agents.find(a => a.name === msg.agent)
            return (
              <motion.div 
                key={msg.id || i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex gap-4"
              >
                <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold mt-1 ${agentProfile?.color || 'bg-gray-500'}`}>
                  {msg.agent.charAt(0)}
                </div>
                
                <div className="flex-1 space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-sm">{msg.agent}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                  </div>
                  
                  {msg.thinking && (
                     <div className="text-xs text-muted-foreground border-l-2 border-border/50 pl-3 py-1 my-1 opacity-70">
                       {msg.thinking}
                     </div>
                  )}

                  <div className={`text-sm ${msg.type === 'tool' ? 'font-mono text-blue-400 bg-blue-500/10 p-2 rounded border border-blue-500/20' : 'text-foreground/90'}`}>
                    {msg.message}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
