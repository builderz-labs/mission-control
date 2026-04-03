'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useJarvis } from '@/lib/jarvis/use-jarvis'
import { getJarvisWsUrl, getJarvisAuthToken, fetchJarvisAuthToken, isJarvisEnabledClient } from '@/lib/jarvis/config'
import { createThreeOrb, type ThreeOrb } from '@/lib/jarvis/three-orb'
import { JarvisExpandedPanel } from './jarvis-expanded-panel'
import { JarvisMiniButton } from './jarvis-mini-button'

type OrbMode = 'mini' | 'expanded'

const MINI_SIZE = 80
const EXPANDED_SIZE = 320

/**
 * JarvisOrbInner — always-on voice assistant orb.
 *
 * Speech recognition is handled entirely by the useJarvis hook:
 * - Auto-starts listening when WebSocket connects
 * - Wake-word "Jarvis" filters transcript before sending to backend
 * - Pauses during speaking/thinking, resumes on idle
 *
 * Clicking the orb expands the panel. No click needed to start listening.
 */
function JarvisOrbInner() {
  const t = useTranslations('jarvis')
  const [mode, setMode] = useState<OrbMode>('mini')
  const [enabled, setEnabled] = useState(isJarvisEnabledClient)
  const [authToken, setAuthToken] = useState<string>(getJarvisAuthToken)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const orbRef = useRef<ThreeOrb | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Fetch auth token from server-side API once on mount
  useEffect(() => {
    if (authToken) return
    fetchJarvisAuthToken().then((t) => { if (t) setAuthToken(t) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The hook handles everything: WS, speech recognition, audio playback, wake-word
  const jarvis = useJarvis({ wsUrl: getJarvisWsUrl(), authToken, enabled: enabled && !!authToken })

  // Lifecycle: create/destroy Three.js orb when mode changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const size = mode === 'expanded' ? EXPANDED_SIZE : MINI_SIZE
    const orb = createThreeOrb(canvas, size, size)
    orb.setAnalyser(jarvis.analyserRef.current)
    orbRef.current = orb
    return () => {
      orb.destroy()
      orbRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Sync JARVIS state and audio analyser into the Three.js orb
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

  // Keyboard: close expanded panel on Escape
  useEffect(() => {
    if (mode !== 'expanded') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode('mini')
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [mode])

  // Resume AudioContext on first user interaction (browser autoplay policy)
  useEffect(() => {
    function ensureAudioContext() {
      // Touching the analyser triggers AudioContext resume in the hook
      if (jarvis.analyserRef.current) {
        const ctx = (jarvis.analyserRef.current as unknown as { context?: AudioContext }).context
        if (ctx && ctx.state === 'suspended') {
          void ctx.resume()
        }
      }
    }
    document.addEventListener('click', ensureAudioContext)
    document.addEventListener('touchstart', ensureAudioContext)
    document.addEventListener('keydown', ensureAudioContext, { once: true })
    return () => {
      document.removeEventListener('click', ensureAudioContext)
      document.removeEventListener('touchstart', ensureAudioContext)
      document.removeEventListener('keydown', ensureAudioContext)
    }
  }, [jarvis.analyserRef])

  function handleExpand() {
    setMode('expanded')
    if (!enabled) setEnabled(true)
  }

  function handleClose() {
    setMode('mini')
  }

  const isExpanded = mode === 'expanded'
  const orbSize = isExpanded ? EXPANDED_SIZE : MINI_SIZE

  return (
    <div className="fixed bottom-20 right-6 sm:bottom-6 z-[45] flex flex-col items-end gap-2">
      {isExpanded ? (
        <JarvisExpandedPanel
          canvasRef={canvasRef}
          size={orbSize}
          jarvisState={jarvis.state}
          interimTranscript={jarvis.interimTranscript}
          transcript={jarvis.transcript}
          response={jarvis.response}
          isListening={jarvis.isListening}
          isMuted={jarvis.isMuted}
          error={jarvis.error}
          onClose={handleClose}
          onToggleMute={jarvis.toggleMute}
          onSendText={jarvis.sendTranscript}
          closeButtonRef={closeButtonRef}
        />
      ) : (
        <JarvisMiniButton
          canvasRef={canvasRef}
          size={orbSize}
          isListening={jarvis.isListening}
          isConnected={jarvis.connected}
          jarvisState={jarvis.state}
          onExpand={handleExpand}
        />
      )}
    </div>
  )
}

// Always render the orb regardless of NEXT_PUBLIC_JARVIS_ENABLED.
// The env var controls whether the WS connection is attempted — not visibility.
export function JarvisOrb() {
  return <JarvisOrbInner />
}
