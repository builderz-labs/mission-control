'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { JarvisState } from '@/lib/jarvis/use-jarvis'

interface Props {
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>
  readonly size: number
  readonly jarvisState: JarvisState
  readonly interimTranscript: string
  readonly transcript: string
  readonly response: string
  readonly isListening: boolean
  readonly isMuted: boolean
  readonly error: string | null
  readonly onClose: () => void
  readonly onToggleMute: () => void
  readonly onSendText: (text: string) => void
  readonly closeButtonRef: React.RefObject<HTMLButtonElement | null>
}

export function JarvisExpandedPanel({
  canvasRef,
  size,
  jarvisState,
  interimTranscript,
  transcript,
  response,
  isListening,
  isMuted,
  error,
  onClose,
  onToggleMute,
  onSendText,
  closeButtonRef,
}: Props) {
  const t = useTranslations('jarvis')
  const [inputText, setInputText] = useState('')

  // Map JarvisState to localised status label
  const stateStatusMap: Record<JarvisState, string> = {
    idle: t('statusLabel'),
    listening: t('statusListening'),
    thinking: t('statusThinking'),
    speaking: t('statusSpeaking'),
    disconnected: t('statusOffline'),
    error: t('statusConnectionLost'),
  }

  // Focus the close button when panel opens (keyboard accessibility)
  const isMounted = useRef(false)
  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true
      closeButtonRef.current?.focus()
    }
  }, [closeButtonRef])

  const isOffline = jarvisState === 'disconnected' || jarvisState === 'error'
  const displayTranscript = interimTranscript || transcript

  function handleSend() {
    const text = inputText.trim()
    if (!text) return
    onSendText(text)
    setInputText('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('ariaLabel')}
      className="w-80 rounded-2xl border border-white/5 bg-zinc-950/95 backdrop-blur-xl shadow-2xl overflow-hidden"
    >
      {/* Orb viewport */}
      <div className="relative" style={{ height: size }}>
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="w-full h-full"
          style={{ width: size, height: size }}
        />
        {/* Close button */}
        <button
          ref={closeButtonRef}
          onClick={onClose}
          className="absolute top-2 right-2 -m-1 p-1 w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors focus:outline-none focus:ring-1 focus:ring-blue-400"
          aria-label={t('minimize')}
        >
          <svg className="w-3.5 h-3.5 text-zinc-300" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
        {/* State label */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className="absolute bottom-3 left-0 right-0 text-center"
        >
          <span className="text-xs text-zinc-300 font-mono tracking-wider uppercase">
            {stateStatusMap[jarvisState]}
          </span>
        </div>
      </div>

      {/* Transcript + controls */}
      <div className="px-4 pb-4 pt-2 space-y-2">
        {/* Error */}
        {error && (
          <div role="alert" className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Live transcript — shows what user is currently saying */}
        {displayTranscript && (
          <div className="rounded-lg bg-white/5 px-3 py-2">
            <p className="text-xs text-zinc-400 italic">{displayTranscript}</p>
          </div>
        )}

        {/* JARVIS response */}
        {response && (
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2">
            <p className="text-xs text-zinc-300">{response}</p>
          </div>
        )}

        {/* Listening indicator — shown when no transcript and not offline */}
        {!displayTranscript && !response && !error && !isOffline && (
          <p className="text-center text-xs text-zinc-500 italic py-1">
            {isListening
              ? 'Listening… say "Jarvis" to activate'
              : isMuted
                ? 'Microphone muted'
                : t('tapToSpeak')
            }
          </p>
        )}

        {/* Text input fallback */}
        <div className="flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Type or say "Jarvis"…'
            className="flex-1 px-3 py-2 text-xs rounded-lg border border-white/10 bg-white/5 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-400/50"
            aria-label="Message to JARVIS"
            disabled={isOffline}
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || isOffline}
            className="px-3 py-2 rounded-lg bg-blue-500/20 text-blue-400 text-xs font-medium border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>

        {/* Mute button */}
        <button
          onClick={onToggleMute}
          disabled={isOffline}
          className={[
            'w-full rounded-xl py-2.5 text-xs font-medium transition-all duration-200',
            isOffline
              ? 'bg-zinc-800 text-zinc-600 border border-zinc-700 cursor-not-allowed'
              : isMuted
                ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25',
          ].join(' ')}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          aria-pressed={isMuted}
        >
          {isOffline
            ? `⚡ ${t('reconnecting')}`
            : isMuted
              ? '🔇 Unmute Microphone'
              : '🎙 Listening — Click to Mute'
          }
        </button>
      </div>
    </div>
  )
}
