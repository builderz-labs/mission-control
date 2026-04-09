'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClientLogger } from '@/lib/client-logger'
import { getVoicePersona, applyVoicePersona, VoicePersona } from './config'
import { createAudioQueue, type AudioQueue } from './audio-queue'
import { useSpeechRecognition } from './use-speech-recognition'

const log = createClientLogger('Jarvis')

export type JarvisState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'disconnected' | 'error'

interface JarvisMessage {
  type: 'text' | 'audio' | 'status' | 'task_spawned' | 'task_complete'
  content?: string
  status?: string
  state?: string
  data?: string
  text?: string
}

interface UseJarvisOptions {
  readonly wsUrl: string
  readonly authToken?: string
  readonly enabled: boolean
  /** C-Suite agent ID — determines which voice persona is applied to TTS output */
  readonly agentId?: string
}

export interface JarvisHandle {
  readonly state: JarvisState
  readonly transcript: string
  readonly response: string
  readonly connected: boolean
  readonly error: string | null
  /** Whether speech recognition is actively listening */
  readonly isListening: boolean
  /** Current interim transcript (what the user is saying right now) */
  readonly interimTranscript: string
  /** Whether the mic is muted by the user */
  readonly isMuted: boolean
  /** Stable ref to the AnalyserNode — set once AudioContext is created, null before first audio chunk */
  readonly analyserRef: { readonly current: AnalyserNode | null }
  /** Active voice persona derived from agentId — drives TTS voice + formality transforms */
  readonly activePersona: VoicePersona
  sendTranscript: (text: string) => void
  connect: () => void
  disconnect: () => void
  toggleMute: () => void
}

// ---------------------------------------------------------------------------
// useJarvis hook
// ---------------------------------------------------------------------------

export function useJarvis({ wsUrl, authToken = '', enabled, agentId }: UseJarvisOptions): JarvisHandle {
  const [state, setState] = useState<JarvisState>('disconnected')
  const [transcript, setTranscript] = useState('')
  const [response, setResponse] = useState('')
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [isMuted, setIsMuted] = useState(false)
  // WHY: Persona is derived from agentId and kept in state so consumers can
  // read voiceId / pitchShift for TTS API calls without re-computing each render.
  const [activePersona, setActivePersona] = useState<VoicePersona>(() =>
    getVoicePersona(agentId ?? 'default')
  )

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioQueueRef = useRef<AudioQueue | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)

  // Refs so closures always see the latest values
  const enabledRef = useRef(enabled)
  useEffect(() => { enabledRef.current = enabled }, [enabled])
  const isMutedRef = useRef(isMuted)
  useEffect(() => { isMutedRef.current = isMuted }, [isMuted])
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])
  const connectedRef = useRef(connected)
  useEffect(() => { connectedRef.current = connected }, [connected])

  // Update persona whenever the active agent changes
  useEffect(() => {
    setActivePersona(getVoicePersona(agentId ?? 'default'))
  }, [agentId])

  // Ref so sendTranscript closure always sees the latest persona without re-creating
  const activePersonaRef = useRef(activePersona)
  useEffect(() => { activePersonaRef.current = activePersona }, [activePersona])

  // -------------------------------------------------------------------------
  // Audio queue lifecycle
  // -------------------------------------------------------------------------

  const ensureAudioQueue = useCallback((): AudioQueue => {
    if (!audioQueueRef.current) {
      const aq = createAudioQueue()
      audioQueueRef.current = aq
      analyserRef.current = aq.getAnalyser()
      // When audio finishes playing, transition back to idle and resume listening
      aq.onFinished(() => {
        setState('idle')
        recognition.resume()
      })
    }
    return audioQueueRef.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -------------------------------------------------------------------------
  // Speech recognition (delegated to useSpeechRecognition)
  // -------------------------------------------------------------------------

  const recognition = useSpeechRecognition({
    isMutedRef,
    connectedRef,
    enabledRef,
    activePersonaRef,
    onInterim: setInterimTranscript,
    onListeningChange: (listening) => {
      setIsListening(listening)
      if (listening) setState(prev => prev === 'disconnected' || prev === 'error' ? prev : 'listening')
    },
    onError: (msg) => setError(msg),
    onFinalUtterance: (processedText, persona) => {
      audioQueueRef.current?.stop()
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'transcript',
          text: processedText,
          isFinal: true,
          voiceId: persona.voiceId,
          pitchShift: persona.pitchShift,
          speedMultiplier: persona.speedMultiplier,
        }))
        setTranscript(processedText)
        setState('thinking')
        recognition.pause()
      }
    },
  })

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  const cleanup = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    recognition.stop()
    if (audioQueueRef.current) {
      audioQueueRef.current.destroy()
      audioQueueRef.current = null
      analyserRef.current = null
    }
    setConnected(false)
    setState('disconnected')
  }, [recognition])

  // -------------------------------------------------------------------------
  // WebSocket message handler
  // -------------------------------------------------------------------------

  const handleStatusMessage = useCallback((s: string | undefined) => {
    if (s === 'thinking' || s === 'working') {
      setState('thinking')
    } else if (s === 'speaking') {
      setState('speaking')
    } else if (s === 'listening') {
      setState('listening')
    } else if (s === 'idle') {
      setState('idle')
      recognition.resume()
    }
  }, [recognition])

  const handleAudioMessage = useCallback((msg: JarvisMessage) => {
    if (msg.data) {
      const aq = ensureAudioQueue()
      if (stateRef.current !== 'speaking') setState('speaking')
      void aq.enqueue(msg.data)
    } else {
      log.warn('[JARVIS] no audio data received, returning to idle')
      setState('idle')
      recognition.resume()
    }
    if (msg.text) {
      setResponse(msg.text)
      log.info('[JARVIS]', msg.text)
    }
  }, [ensureAudioQueue, recognition])

  const handleMessage = useCallback((event: MessageEvent) => {
    if (typeof event.data !== 'string') {
      if (event.data instanceof Blob) {
        void (async () => {
          try {
            const aq = ensureAudioQueue()
            const arrayBuffer = await event.data.arrayBuffer()
            const bytes = new Uint8Array(arrayBuffer)
            const base64 = btoa(String.fromCharCode.apply(null, Array.from(bytes)))
            if (stateRef.current !== 'speaking') setState('speaking')
            await aq.enqueue(base64)
          } catch {
            setError('Failed to decode audio blob')
          }
        })()
      }
      return
    }
    try {
      const msg: JarvisMessage = JSON.parse(event.data)
      switch (msg.type) {
        case 'text': setResponse(msg.content ?? msg.text ?? ''); break
        case 'status': handleStatusMessage(msg.status ?? msg.state); break
        case 'audio': handleAudioMessage(msg); break
        case 'task_spawned': log.info('[JARVIS] task spawned'); break
        case 'task_complete': log.info('[JARVIS] task complete'); break
      }
    } catch { /* Non-JSON frames silently ignored */ }
  }, [ensureAudioQueue, handleStatusMessage, handleAudioMessage])

  // -------------------------------------------------------------------------
  // Connect
  // -------------------------------------------------------------------------

  const connect = useCallback(() => {
    if (!enabledRef.current) return
    cleanup()
    try {
      const tokenParam = authToken ? `?token=${encodeURIComponent(authToken)}` : ''
      const ws = new WebSocket(`${wsUrl}/ws/voice${tokenParam}`)
      wsRef.current = ws
      ws.onopen = () => {
        setConnected(true)
        setState('idle')
        setError(null)
        if (!isMutedRef.current) {
          setTimeout(() => {
            if (enabledRef.current && !isMutedRef.current) void recognition.start()
          }, 500)
        }
      }
      ws.onmessage = handleMessage
      ws.onclose = () => {
        setConnected(false)
        setState('disconnected')
        recognition.stop()
        if (enabledRef.current) {
          reconnectTimer.current = setTimeout(() => connectRef.current(), 3000)
        }
      }
      ws.onerror = () => {
        if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null }
        setError('WebSocket connection failed')
        setState('error')
      }
    } catch {
      setError('Failed to create WebSocket connection')
      setState('error')
    }
  }, [wsUrl, authToken, cleanup, handleMessage, recognition])

  const connectRef = useRef(connect)
  const cleanupRef = useRef(cleanup)
  connectRef.current = connect
  cleanupRef.current = cleanup

  // -------------------------------------------------------------------------
  // sendTranscript (text input fallback)
  // -------------------------------------------------------------------------

  const sendTranscript = useCallback((text: string) => {
    // Apply persona formality transform before sending to backend TTS pipeline
    const processedText = applyVoicePersona(activePersonaRef.current, text)
    setTranscript(processedText)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      audioQueueRef.current?.stop()
      wsRef.current.send(JSON.stringify({
        type: 'transcript',
        text: processedText,
        isFinal: true,
        voiceId: activePersonaRef.current.voiceId,
        pitchShift: activePersonaRef.current.pitchShift,
        speedMultiplier: activePersonaRef.current.speedMultiplier,
      }))
      setState('thinking')
      recognition.pause()
    } else {
      setError('Not connected — message was not sent. Reconnecting...')
    }
  }, [recognition])

  // -------------------------------------------------------------------------
  // Mute toggle
  // -------------------------------------------------------------------------

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const newMuted = !prev
      isMutedRef.current = newMuted
      if (newMuted) {
        recognition.stop()
        setState(s => s === 'listening' ? 'idle' : s)
      } else if (connectedRef.current) {
        void recognition.start()
      }
      return newMuted
    })
  }, [recognition])

  const disconnect = useCallback(() => cleanup(), [cleanup])

  useEffect(() => {
    if (enabled) connectRef.current()
    return () => cleanupRef.current()
  }, [enabled])

  return {
    state, transcript, response, connected, error,
    isListening, interimTranscript, isMuted,
    analyserRef, activePersona,
    sendTranscript, connect, disconnect, toggleMute,
  }
}
