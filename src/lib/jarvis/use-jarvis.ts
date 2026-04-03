'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

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
  sendTranscript: (text: string) => void
  connect: () => void
  disconnect: () => void
  toggleMute: () => void
}

// ---------------------------------------------------------------------------
// Speech Recognition types (Web Speech API)
// ---------------------------------------------------------------------------

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onresult: ((event: any) => void) | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
}

// ---------------------------------------------------------------------------
// Audio queue — sequential playback matching tonys-jarvis createAudioPlayer
// ---------------------------------------------------------------------------

interface AudioQueue {
  enqueue(base64: string): Promise<void>
  stop(): void
  getAnalyser(): AnalyserNode
  onFinished(cb: () => void): void
  destroy(): void
}

function createAudioQueue(): AudioQueue {
  const audioCtx = new AudioContext()
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.8
  analyser.connect(audioCtx.destination)

  const queue: AudioBuffer[] = []
  let isPlaying = false
  let currentSource: AudioBufferSourceNode | null = null
  let finishedCallback: (() => void) | null = null

  function playNext() {
    if (queue.length === 0) {
      isPlaying = false
      currentSource = null
      finishedCallback?.()
      return
    }

    isPlaying = true
    const buffer = queue.shift()!
    const source = audioCtx.createBufferSource()
    source.buffer = buffer
    source.connect(analyser)
    currentSource = source

    source.onended = () => {
      if (currentSource === source) {
        playNext()
      }
    }

    source.start()
  }

  return {
    async enqueue(base64: string) {
      // Resume audio context (browser autoplay policy)
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }

      try {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i)
        }
        const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer.slice(0))
        queue.push(audioBuffer)
        if (!isPlaying) playNext()
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[JARVIS] audio decode error:', err)
        }
        // Skip bad audio, continue
        if (!isPlaying && queue.length > 0) playNext()
      }
    },

    stop() {
      queue.length = 0
      if (currentSource) {
        try {
          currentSource.stop()
        } catch {
          // Already stopped
        }
        currentSource = null
      }
      isPlaying = false
    },

    getAnalyser() {
      return analyser
    },

    onFinished(cb: () => void) {
      finishedCallback = cb
    },

    destroy() {
      this.stop()
      void audioCtx.close()
    },
  }
}

// ---------------------------------------------------------------------------
// Wake-word detection
// ---------------------------------------------------------------------------

const WAKE_WORD = /\bjarvis\b/i

function containsWakeWord(text: string): boolean {
  return WAKE_WORD.test(text)
}

// ---------------------------------------------------------------------------
// useJarvis hook
// ---------------------------------------------------------------------------

export function useJarvis({ wsUrl, authToken = '', enabled }: UseJarvisOptions): JarvisHandle {
  const [state, setState] = useState<JarvisState>('disconnected')
  const [transcript, setTranscript] = useState('')
  const [response, setResponse] = useState('')
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [isMuted, setIsMuted] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioQueueRef = useRef<AudioQueue | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  // Refs so closures always see the latest values
  const enabledRef = useRef(enabled)
  useEffect(() => { enabledRef.current = enabled }, [enabled])
  const isMutedRef = useRef(isMuted)
  useEffect(() => { isMutedRef.current = isMuted }, [isMuted])
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])
  const connectedRef = useRef(connected)
  useEffect(() => { connectedRef.current = connected }, [connected])

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
        resumeRecognition()
      })
    }
    return audioQueueRef.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -------------------------------------------------------------------------
  // Speech recognition
  // -------------------------------------------------------------------------

  const startRecognition = useCallback(async () => {
    if (isMutedRef.current) return
    if (recognitionRef.current) return // Already running

    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SR) {
      setError('Speech recognition not supported in this browser')
      return
    }

    // Request microphone permission explicitly before starting recognition.
    // Some browsers (especially with strict CSP) require getUserMedia grant
    // before SpeechRecognition.start() will succeed.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Release the stream immediately — we only needed the permission grant
      stream.getTracks().forEach(t => t.stop())
    } catch {
      setError('Microphone access denied. Please allow microphone access in your browser settings.')
      return
    }

    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    let shouldListen = true

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0]?.transcript?.trim() ?? ''

        if (result.isFinal) {
          setInterimTranscript('')
          // Only send to backend if wake word is present
          if (text && containsWakeWord(text)) {
            // Stop any current audio before sending new input
            audioQueueRef.current?.stop()
            // Send the full transcript to the backend
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'transcript',
                text,
                isFinal: true,
              }))
              setTranscript(text)
              setState('thinking')
              // Pause recognition while JARVIS is thinking/speaking
              pauseRecognition()
            }
          }
        } else {
          // Show interim results
          setInterimTranscript(text)
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        setError('Microphone access denied. Please allow microphone access.')
        shouldListen = false
        setIsListening(false)
      } else if (event.error === 'no-speech') {
        // Normal — just restart
      } else if (event.error === 'aborted') {
        // Expected during pause
      } else {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[JARVIS] recognition error:', event.error)
        }
      }
    }

    recognition.onend = () => {
      // Auto-restart if we should still be listening
      if (shouldListen && !isMutedRef.current && connectedRef.current) {
        try {
          recognition.start()
        } catch {
          // Already started
        }
      } else {
        setIsListening(false)
      }
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setIsListening(true)
      setState(prev => prev === 'disconnected' || prev === 'error' ? prev : 'listening')
    } catch {
      // Already started
    }
  }, [])

  const pauseRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        // Already stopped
      }
      recognitionRef.current = null
      setIsListening(false)
    }
  }, [])

  const resumeRecognition = useCallback(() => {
    if (!isMutedRef.current && connectedRef.current && enabledRef.current) {
      // Small delay to let the audio finish settling
      setTimeout(() => {
        if (!isMutedRef.current && connectedRef.current) {
          startRecognition()
        }
      }, 300)
    }
  }, [startRecognition])

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      // Disconnect the auto-restart by nulling the ref first
      const rec = recognitionRef.current
      recognitionRef.current = null
      try {
        rec.stop()
      } catch {
        // Already stopped
      }
      setIsListening(false)
    }
  }, [])

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
    // Stop recognition
    stopRecognition()
    // Destroy audio queue to prevent browser resource leak
    if (audioQueueRef.current) {
      audioQueueRef.current.destroy()
      audioQueueRef.current = null
      analyserRef.current = null
    }
    setConnected(false)
    setState('disconnected')
  }, [stopRecognition])

  // -------------------------------------------------------------------------
  // WebSocket message handler
  // -------------------------------------------------------------------------

  const handleMessage = useCallback((event: MessageEvent) => {
    // Guard binary frames before attempting JSON parse
    if (typeof event.data !== 'string') {
      if (event.data instanceof Blob) {
        // Binary audio blob
        void (async () => {
          try {
            const aq = ensureAudioQueue()
            const arrayBuffer = await event.data.arrayBuffer()
            const bytes = new Uint8Array(arrayBuffer)
            const binary = String.fromCharCode.apply(null, Array.from(bytes))
            const base64 = btoa(binary)
            if (stateRef.current !== 'speaking') setState('speaking')
            await aq.enqueue(base64)
          } catch (err) {
            setError('Failed to decode audio blob')
            if (process.env.NODE_ENV !== 'production') {
              console.warn('[JARVIS] Blob decode error:', err)
            }
          }
        })()
      }
      return
    }
    try {
      const msg: JarvisMessage = JSON.parse(event.data)
      switch (msg.type) {
        case 'text':
          setResponse(msg.content ?? msg.text ?? '')
          break
        case 'status': {
          const s = msg.status ?? msg.state
          if (s === 'thinking' && stateRef.current !== 'thinking') {
            setState('thinking')
          } else if (s === 'working') {
            setState('thinking')
          } else if (s === 'speaking') {
            setState('speaking')
          } else if (s === 'listening') {
            setState('listening')
          } else if (s === 'idle') {
            setState('idle')
            resumeRecognition()
          }
          break
        }
        case 'audio': {
          if (msg.data) {
            const aq = ensureAudioQueue()
            if (stateRef.current !== 'speaking') setState('speaking')
            void aq.enqueue(msg.data)
          } else {
            // TTS failed — no audio, return to idle
            if (process.env.NODE_ENV !== 'production') {
              console.warn('[JARVIS] no audio data received, returning to idle')
            }
            setState('idle')
            resumeRecognition()
          }
          if (msg.text) {
            setResponse(msg.text)
            if (process.env.NODE_ENV !== 'production') {
              console.log('[JARVIS]', msg.text)
            }
          }
          break
        }
        case 'task_spawned':
          if (process.env.NODE_ENV !== 'production') {
            console.log('[JARVIS] task spawned')
          }
          break
        case 'task_complete':
          if (process.env.NODE_ENV !== 'production') {
            console.log('[JARVIS] task complete')
          }
          break
      }
    } catch {
      // Non-JSON string frames are silently ignored
    }
  }, [ensureAudioQueue, resumeRecognition])

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
        // Auto-start voice recognition on connect
        if (!isMutedRef.current) {
          // Small delay for the browser to settle
          setTimeout(() => {
            if (enabledRef.current && !isMutedRef.current) {
              startRecognition()
            }
          }, 500)
        }
      }
      ws.onmessage = handleMessage
      ws.onclose = () => {
        setConnected(false)
        setState('disconnected')
        stopRecognition()
        if (enabledRef.current) {
          reconnectTimer.current = setTimeout(() => connectRef.current(), 3000)
        }
      }
      ws.onerror = () => {
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current)
          reconnectTimer.current = null
        }
        setError('WebSocket connection failed')
        setState('error')
      }
    } catch {
      setError('Failed to create WebSocket connection')
      setState('error')
    }
  }, [wsUrl, authToken, cleanup, handleMessage, startRecognition, stopRecognition])

  // Refs that always hold the latest connect/cleanup functions
  const connectRef = useRef(connect)
  const cleanupRef = useRef(cleanup)
  connectRef.current = connect
  cleanupRef.current = cleanup

  // -------------------------------------------------------------------------
  // sendTranscript (for text input fallback)
  // -------------------------------------------------------------------------

  const sendTranscript = useCallback((text: string) => {
    setTranscript(text)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Stop any current audio
      audioQueueRef.current?.stop()
      wsRef.current.send(JSON.stringify({
        type: 'transcript',
        text,
        isFinal: true,
      }))
      setState('thinking')
      pauseRecognition()
    } else {
      setError('Not connected — message was not sent. Reconnecting...')
    }
  }, [pauseRecognition])

  // -------------------------------------------------------------------------
  // Mute toggle
  // -------------------------------------------------------------------------

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const newMuted = !prev
      isMutedRef.current = newMuted
      if (newMuted) {
        stopRecognition()
        setState(s => s === 'listening' ? 'idle' : s)
      } else if (connectedRef.current) {
        startRecognition()
      }
      return newMuted
    })
  }, [stopRecognition, startRecognition])

  const disconnect = useCallback(() => {
    cleanup()
  }, [cleanup])

  // Only re-fire when `enabled` flips
  useEffect(() => {
    if (enabled) connectRef.current()
    return () => cleanupRef.current()
  }, [enabled])

  return {
    state,
    transcript,
    response,
    connected,
    error,
    isListening,
    interimTranscript,
    isMuted,
    analyserRef,
    sendTranscript,
    connect,
    disconnect,
    toggleMute,
  }
}
