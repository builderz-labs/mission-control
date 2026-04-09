'use client'

/**
 * useSpeechRecognition — thin wrapper around the Web Speech API.
 *
 * WHY a separate hook: keeps use-jarvis.ts under 400 lines, isolates
 * browser-specific Speech API handling, and makes each function ≤ 50 lines.
 */

import { useCallback, useRef } from 'react'
import { containsWakeWord } from './wake-word'
import { applyVoicePersona } from './config'
import type { VoicePersona } from './config'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('Jarvis')

// Web Speech API interfaces (not in all TS lib versions)
export interface SpeechRecognitionResultEvent extends Event {
  readonly resultIndex: number
  readonly results: ReadonlyArray<
    ReadonlyArray<{ readonly transcript: string }> & { readonly isFinal: boolean }
  >
}

export interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string
}

export interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
}

interface UseSpeechRecognitionOptions {
  /** Current mute state ref — avoids stale closure captures */
  readonly isMutedRef: React.MutableRefObject<boolean>
  /** Whether WS is connected ref */
  readonly connectedRef: React.MutableRefObject<boolean>
  /** Whether the feature is enabled ref */
  readonly enabledRef: React.MutableRefObject<boolean>
  /** Called with the interim text as the user speaks */
  onInterim: (text: string) => void
  /** Called when the user finishes a final utterance containing the wake word */
  onFinalUtterance: (processedText: string, persona: VoicePersona) => void
  /** Called when recognition starts/stops */
  onListeningChange: (listening: boolean) => void
  /** Called when permission is denied */
  onError: (message: string) => void
  /** Ref to the active voice persona */
  readonly activePersonaRef: React.MutableRefObject<VoicePersona>
}

export interface SpeechRecognitionHandle {
  readonly recognitionRef: React.MutableRefObject<SpeechRecognitionLike | null>
  start: () => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => void
}

/**
 * Creates and manages a Web Speech API recognition session.
 * Automatically restarts on silence ('no-speech') and on end events
 * as long as the session should remain active.
 */
export function useSpeechRecognition(opts: UseSpeechRecognitionOptions): SpeechRecognitionHandle {
  const {
    isMutedRef, connectedRef, enabledRef,
    onInterim, onFinalUtterance, onListeningChange, onError, activePersonaRef,
  } = opts

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const start = useCallback(async (): Promise<void> => {
    if (isMutedRef.current || recognitionRef.current) return
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SR) { onError('Speech recognition not supported in this browser'); return }

    // Explicitly request mic permission before SpeechRecognition.start()
    // (required in browsers with strict CSP / permission policies)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(t => t.stop())
    } catch {
      onError('Microphone access denied. Please allow microphone access in your browser settings.')
      return
    }

    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    let shouldListen = true

    recognition.onresult = (event: SpeechRecognitionResultEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0]?.transcript?.trim() ?? ''
        if (result.isFinal) {
          onInterim('')
          if (text && containsWakeWord(text)) {
            const processed = applyVoicePersona(activePersonaRef.current, text)
            onFinalUtterance(processed, activePersonaRef.current)
          }
        } else {
          onInterim(text)
        }
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'not-allowed') {
        onError('Microphone access denied. Please allow microphone access.')
        shouldListen = false
        onListeningChange(false)
      } else if (event.error === 'aborted') {
        // Expected during pause — suppress
      } else if (event.error !== 'no-speech') {
        log.warn('[JARVIS] recognition error:', event.error)
      }
    }

    recognition.onend = () => {
      if (shouldListen && !isMutedRef.current && connectedRef.current) {
        try { recognition.start() } catch { /* already started */ }
      } else {
        onListeningChange(false)
      }
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      onListeningChange(true)
    } catch { /* already started */ }
  }, [isMutedRef, connectedRef, onInterim, onFinalUtterance, onListeningChange, onError, activePersonaRef])

  const pause = useCallback(() => {
    if (!recognitionRef.current) return
    try { recognitionRef.current.stop() } catch { /* already stopped */ }
    recognitionRef.current = null
    onListeningChange(false)
  }, [onListeningChange])

  const resume = useCallback(() => {
    if (!isMutedRef.current && connectedRef.current && enabledRef.current) {
      setTimeout(() => {
        if (!isMutedRef.current && connectedRef.current) void start()
      }, 300)
    }
  }, [isMutedRef, connectedRef, enabledRef, start])

  const stop = useCallback(() => {
    if (!recognitionRef.current) return
    const rec = recognitionRef.current
    recognitionRef.current = null
    try { rec.stop() } catch { /* already stopped */ }
    onListeningChange(false)
  }, [onListeningChange])

  return { recognitionRef, start, pause, resume, stop }
}
