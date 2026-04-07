'use client'

import type { JarvisState } from '@/lib/jarvis/use-jarvis'
import { JARVIS_STATE_COLORS } from '@/lib/jarvis/state-colors'

interface Props {
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>
  readonly size: number
  readonly isListening: boolean
  readonly isConnected: boolean
  readonly jarvisState: JarvisState
  readonly onExpand: () => void
}

/**
 * Corner badge that mirrors the live JARVIS state.
 * WHY: Uses JARVIS_STATE_COLORS inline styles (same source as the expanded panel)
 * so the dot colour is always in sync with the orb and panel border.
 * Priority: mic-active (listening) > backend state.
 */
function StateBadge({ isListening, jarvisState, isConnected }: Pick<Props, 'isListening' | 'jarvisState' | 'isConnected'>) {
  // No badge when fully disconnected and mic is off
  if (!isConnected && !isListening && jarvisState !== 'error') return null

  // Pick the canonical state colour; listening overrides to its own colour
  const effectiveState: JarvisState = isListening ? 'listening' : jarvisState
  const { hex, rgb } = JARVIS_STATE_COLORS[effectiveState]

  // Active states pulse; passive states (idle, disconnected) are static
  const pulse = effectiveState === 'listening' || effectiveState === 'thinking' || effectiveState === 'speaking'

  return (
    <span
      aria-hidden="true"
      className={['absolute -top-0.5 -right-0.5 rounded-full ring-2 ring-zinc-950', pulse ? 'animate-pulse' : ''].join(' ').trim()}
      style={{
        width: effectiveState === 'disconnected' ? '10px' : '12px',
        height: effectiveState === 'disconnected' ? '10px' : '12px',
        background: hex,
        boxShadow: `0 0 5px 1px rgba(${rgb}, 0.5)`,
      }}
    />
  )
}

export function JarvisMiniButton({ canvasRef, size, isListening, isConnected, jarvisState, onExpand }: Props) {
  return (
    <button
      onClick={onExpand}
      className="relative rounded-full overflow-hidden shadow-xl hover:scale-105 active:scale-95 transition-transform duration-150 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
      style={{ width: size, height: size }}
      aria-label={`Open JARVIS voice assistant — ${jarvisState}`}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="w-full h-full"
        style={{ width: size, height: size }}
      />
      <StateBadge isListening={isListening} jarvisState={jarvisState} isConnected={isConnected} />
    </button>
  )
}
