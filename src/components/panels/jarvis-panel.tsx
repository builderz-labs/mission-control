'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { isJarvisEnabledClient, getJarvisWsUrl, getJarvisAuthToken, fetchJarvisAuthToken } from '@/lib/jarvis/config'
import { useJarvis, type JarvisState } from '@/lib/jarvis/use-jarvis'
import { createThreeOrb, type ThreeOrb } from '@/lib/jarvis/three-orb'

/** Map JarvisState to accent color classes */
function stateColor(state: JarvisState): { text: string; glow: string; ring: string } {
  switch (state) {
    case 'idle': return { text: 'text-blue-400', glow: 'shadow-blue-500/20', ring: 'border-blue-500/30' }
    case 'listening': return { text: 'text-green-400', glow: 'shadow-green-500/20', ring: 'border-green-500/30' }
    case 'thinking': return { text: 'text-amber-400', glow: 'shadow-amber-500/20', ring: 'border-amber-500/30' }
    case 'speaking': return { text: 'text-sky-400', glow: 'shadow-sky-500/20', ring: 'border-sky-500/30' }
    case 'disconnected': return { text: 'text-zinc-400', glow: 'shadow-zinc-500/10', ring: 'border-zinc-500/20' }
    case 'error': return { text: 'text-red-400', glow: 'shadow-red-500/20', ring: 'border-red-500/30' }
  }
}

interface ConversationEntry {
  readonly role: 'user' | 'jarvis'
  readonly text: string
  readonly timestamp: number
}

function JarvisPanelInner() {
  const t = useTranslations('jarvis')
  const [enabled, setEnabled] = useState(isJarvisEnabledClient)
  const [authToken, setAuthToken] = useState<string>(getJarvisAuthToken)
  const [conversation, setConversation] = useState<ConversationEntry[]>([])
  const [inputText, setInputText] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const orbRef = useRef<ThreeOrb | null>(null)
  const conversationEndRef = useRef<HTMLDivElement>(null)
  const isConfigured = isJarvisEnabledClient()

  // Fetch auth token from server-side API once on mount
  useEffect(() => {
    if (authToken) return
    fetchJarvisAuthToken().then((t) => { if (t) setAuthToken(t) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The hook handles WS, speech recognition, audio, and wake-word
  const jarvis = useJarvis({ wsUrl: getJarvisWsUrl(), authToken, enabled: enabled && !!authToken })
  const colors = stateColor(jarvis.state)

  const stateLabelMap: Record<JarvisState, string> = {
    idle: t('stateReady'),
    listening: t('stateListening'),
    thinking: t('stateThinking'),
    speaking: t('stateSpeaking'),
    disconnected: t('stateOffline'),
    error: t('stateError'),
  }

  // Build orb once on mount, sized to the stage container
  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return
    const { width, height } = stage.getBoundingClientRect()
    const w = Math.round(width) || 420
    const h = Math.round(height) || 420
    canvas.width = w
    canvas.height = h
    const orb = createThreeOrb(canvas, w, h)
    orb.setAnalyser(jarvis.analyserRef.current)
    orbRef.current = orb

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return
      const nw = Math.round(entry.contentRect.width)
      const nh = Math.round(entry.contentRect.height)
      if (nw > 0 && nh > 0) {
        canvas.width = nw
        canvas.height = nh
        orbRef.current?.resize(nw, nh)
      }
    })
    ro.observe(stage)

    return () => {
      ro.disconnect()
      orb.destroy()
      orbRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync JARVIS state into orb
  useEffect(() => {
    const s = jarvis.state
    orbRef.current?.setAnalyser(jarvis.analyserRef.current)
    if (s === 'listening') orbRef.current?.setState('listening')
    else if (s === 'thinking') orbRef.current?.setState('thinking')
    else if (s === 'speaking') orbRef.current?.setState('speaking')
    else if (s === 'disconnected') orbRef.current?.setState('disconnected')
    else if (s === 'error') orbRef.current?.setState('error')
    else orbRef.current?.setState('idle')
  }, [jarvis.state, jarvis.analyserRef])

  // Append JARVIS responses to conversation log
  useEffect(() => {
    if (!jarvis.response) return
    setConversation(prev => [
      ...prev,
      { role: 'jarvis', text: jarvis.response, timestamp: Date.now() },
    ])
  }, [jarvis.response])

  // Append user transcripts to conversation log
  useEffect(() => {
    if (!jarvis.transcript) return
    setConversation(prev => [
      ...prev,
      { role: 'user', text: jarvis.transcript, timestamp: Date.now() },
    ])
  }, [jarvis.transcript])

  // Auto-scroll conversation to bottom
  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation])

  function handleActivate() {
    setEnabled(true)
    jarvis.connect()
  }

  function handleDeactivate() {
    setEnabled(false)
    jarvis.disconnect()
  }

  function handleSend() {
    const text = inputText.trim()
    if (!text) return
    jarvis.sendTranscript(text)
    setInputText('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col bg-background overflow-hidden" style={{ minHeight: 'calc(100svh - 200px)' }}>
      {/* Orb stage */}
      <div ref={stageRef} className="relative flex-1 flex flex-col items-center justify-end bg-black overflow-hidden min-h-0 pb-6 gap-3">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          aria-label={`JARVIS orb — ${stateLabelMap[jarvis.state]}`}
        />

        {/* State label */}
        <p className={`relative z-10 text-xs font-mono font-semibold tracking-[0.2em] uppercase ${colors.text}`}>
          {stateLabelMap[jarvis.state]}
        </p>

        {/* Live transcript */}
        {jarvis.interimTranscript && (
          <p className="relative z-10 text-sm text-zinc-300 italic text-center max-w-md px-4 animate-pulse">
            &ldquo;{jarvis.interimTranscript}&rdquo;
          </p>
        )}

        {/* Listening hint */}
        {jarvis.connected && jarvis.isListening && !jarvis.interimTranscript && jarvis.state === 'listening' && (
          <p className="relative z-10 text-xs text-zinc-500 italic">
            Say &ldquo;Jarvis&rdquo; to activate
          </p>
        )}

        {/* Not configured notice */}
        {!isConfigured && (
          <p className="relative z-10 text-xs text-muted-foreground/60 text-center max-w-xs px-4">
            Set <code className="bg-muted px-1 rounded text-[11px]">NEXT_PUBLIC_JARVIS_ENABLED=true</code> to connect
          </p>
        )}

        {/* Connect / Disconnect button */}
        {isConfigured && !jarvis.connected && (
          <button
            onClick={handleActivate}
            className={`relative z-10 flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium border transition-all duration-200 hover:scale-105 active:scale-95 ${colors.ring} bg-white/5 hover:bg-white/10 ${colors.text}`}
          >
            <span>⚡</span>
            <span>{t('reconnecting')}</span>
          </button>
        )}

        {isConfigured && jarvis.connected && (
          <div className="relative z-10 flex items-center gap-3">
            {/* Mute/Unmute */}
            <button
              onClick={jarvis.toggleMute}
              className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-colors ${jarvis.isMuted
                  ? 'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                }`}
              aria-label={jarvis.isMuted ? 'Unmute' : 'Mute'}
            >
              {jarvis.isMuted ? '🔇 Unmute' : '🎙 Listening'}
            </button>
            {/* Disconnect */}
            <button
              onClick={handleDeactivate}
              className="px-4 py-1.5 rounded-full text-xs font-medium border border-zinc-500/30 bg-white/5 text-zinc-400 hover:bg-white/10 transition-colors"
            >
              Disconnect
            </button>
          </div>
        )}

        {/* Error */}
        {jarvis.error && (
          <p className="relative z-10 text-xs text-red-400 text-center max-w-xs px-4" role="alert">
            {jarvis.error}
          </p>
        )}
      </div>

      {/* Conversation log */}
      {conversation.length > 0 && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {conversation.map((entry) => (
            <div
              key={entry.timestamp}
              className={`flex gap-2 ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${entry.role === 'user'
                    ? 'bg-primary/15 text-primary-foreground ml-auto'
                    : 'bg-muted text-foreground'
                  }`}
              >
                <span className="text-xs font-medium opacity-60 block mb-0.5">
                  {entry.role === 'user' ? 'You' : 'JARVIS'}
                </span>
                {entry.text}
              </div>
            </div>
          ))}
          <div ref={conversationEndRef} />
        </div>
      )}

      {/* Text input */}
      {jarvis.connected && (
        <div className="flex-shrink-0 flex gap-2 px-4 py-3 border-t border-border">
          <input
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message to JARVIS…"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            aria-label="Message to JARVIS"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      )}
    </div>
  )
}

export function JarvisPanel() {
  return <JarvisPanelInner />
}
