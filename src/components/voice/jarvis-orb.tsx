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
    async function loadToken(): Promise<void> {
      try {
        const token = await fetchJarvisAuthToken()
        if (token) setAuthToken(token)
      } catch (err) {
        // WHY: non-fatal — orb will render in disabled state without a token;
        // log so operators can diagnose auth endpoint issues without crashing the UI.
        console.error('[JarvisOrb] Failed to fetch auth token:', err)
      }
    }
    void loadToken()
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

  // Sync JARVIS state into the Three.js orb.
  // WHY: analyserRef is a stable ref object — its identity never changes, so it
  // must not be a dep. We read .current at call time; only jarvis.state triggers re-runs.
  useEffect(() => {
    orbRef.current?.setAnalyser(jarvis.analyserRef.current)
    orbRef.current?.setState(jarvis.state)
  }, [jarvis.state]) // eslint-disable-line react-hooks/exhaustive-deps

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
