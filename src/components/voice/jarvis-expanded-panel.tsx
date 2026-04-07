'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { JarvisState } from '@/lib/jarvis/use-jarvis'
import { JARVIS_STATE_COLORS } from '@/lib/jarvis/state-colors'

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

  // Memoised: t() is called once per state value, not on every render
  const stateStatusMap = useMemo<Record<JarvisState, string>>(() => ({
    idle:         t('statusLabel'),
    listening:    t('statusListening'),
    thinking:     t('statusThinking'),
    speaking:     t('statusSpeaking'),
    disconnected: t('statusOffline'),
    error:        t('statusConnectionLost'),
  }), [t])

  // Focus the close button when the panel opens (keyboard accessibility)
  useEffect(() => {
    closeButtonRef.current?.focus()
  // WHY: empty deps — we only want this on mount, not on every closeButtonRef change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isOffline = jarvisState === 'disconnected' || jarvisState === 'error'
  const { rgb, hex } = JARVIS_STATE_COLORS[jarvisState]
  const isPulsing = jarvisState === 'listening' || jarvisState === 'thinking'

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
      className="w-80 rounded-2xl overflow-hidden backdrop-blur-xl shadow-2xl"
      style={{
        background: 'rgba(8, 10, 18, 0.95)',
        border: `1px solid rgba(${rgb}, 0.25)`,
        boxShadow: `0 0 40px rgba(${rgb}, 0.08), 0 25px 50px rgba(0, 0, 0, 0.5)`,
        transition: 'border-color 0.6s ease, box-shadow 0.6s ease',
      }}
    >
      {/* Orb viewport */}
      <div className="relative" style={{ height: size }}>
        {/* State-driven radial glow — sits behind the canvas */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 70% 60% at 50% 50%, rgba(${rgb}, 0.1) 0%, transparent 70%)`,
            transition: 'background 0.8s ease',
          }}
        />

        {/* CRT scan-line atmosphere overlay */}
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none z-10 jarvis-scanlines" />

        {/* Canvas: explicit pixel dimensions — className size utilities would be overridden anyway */}
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{ display: 'block', width: size, height: size }}
        />

        {/* Close button */}
        <button
          ref={closeButtonRef}
          onClick={onClose}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors focus:outline-none focus:ring-1 focus:ring-blue-400 z-20"
          aria-label={t('minimize')}
        >
          <svg className="w-3.5 h-3.5 text-zinc-300" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>

        {/* State pill — top-left, mirrors standalone JARVIS design */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className="absolute top-2 left-2 flex items-center gap-1.5 px-2.5 py-1 rounded-full z-20"
          style={{
            border: `1px solid rgba(${rgb}, 0.2)`,
            background: `rgba(${rgb}, 0.08)`,
            backdropFilter: 'blur(8px)',
            transition: 'border-color 0.6s ease, background 0.6s ease',
          }}
        >
          <span
            className={isPulsing ? 'animate-pulse' : ''}
            style={{
              display: 'block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: hex,
              boxShadow: `0 0 6px 1px rgba(${rgb}, 0.5)`,
              flexShrink: 0,
            }}
          />
          <span
            className="text-[10px] tracking-widest uppercase font-light"
            style={{ color: `rgba(${rgb}, 0.75)`, transition: 'color 0.6s ease' }}
          >
            {stateStatusMap[jarvisState]}
          </span>
        </div>
      </div>

      {/* Transcript + controls */}
      <div className="px-4 pb-4 pt-3 space-y-2">
        {/* Error */}
        {error && (
          <div role="alert" className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Interim transcript — what the user is saying right now (fades when final arrives) */}
        {interimTranscript && (
          <div
            className="rounded-lg px-3 py-2"
            style={{
              background: `rgba(${rgb}, 0.04)`,
              border: `1px solid rgba(${rgb}, 0.1)`,
            }}
          >
            <p className="text-xs italic" style={{ color: `rgba(${rgb}, 0.6)` }}>
              {interimTranscript}
            </p>
          </div>
        )}

        {/* Finalised transcript */}
        {transcript && !interimTranscript && (
          <div
            className="rounded-lg px-3 py-2"
            style={{
              background: `rgba(${rgb}, 0.06)`,
              border: `1px solid rgba(${rgb}, 0.12)`,
            }}
          >
            <p className="text-xs italic" style={{ color: `rgba(${rgb}, 0.7)` }}>
              {transcript}
            </p>
          </div>
        )}

        {/* JARVIS response */}
        {response && (
          <div
            className="rounded-lg px-3 py-2"
            style={{
              background: `rgba(${rgb}, 0.08)`,
              border: `1px solid rgba(${rgb}, 0.18)`,
            }}
          >
            <p className="text-xs text-zinc-300">{response}</p>
          </div>
        )}

        {/* Idle hint — shown when quiet and online */}
        {!interimTranscript && !transcript && !response && !error && !isOffline && (
          <p className="text-center text-xs italic py-1" style={{ color: `rgba(${rgb}, 0.45)` }}>
            {isListening
              ? t('wakeHint')
              : isMuted
                ? t('mutedHint')
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
            placeholder={t('inputPlaceholder')}
            className="flex-1 px-3 py-2 text-xs rounded-lg border border-white/10 bg-white/5 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-400/50"
            aria-label={t('inputPlaceholder')}
            disabled={isOffline}
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || isOffline}
            className="px-3 py-2 rounded-lg bg-blue-500/20 text-blue-400 text-xs font-medium border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('send')}
          </button>
        </div>

        {/* Mute toggle */}
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
          aria-label={isMuted ? t('startListening') : t('stopListening')}
          aria-pressed={isMuted}
        >
          {isOffline
            ? t('reconnecting')
            : isMuted
              ? t('startListening')
              : t('stopListening')
          }
        </button>
      </div>
    </div>
  )
}
