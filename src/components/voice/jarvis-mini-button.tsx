'use client'

import type { JarvisState } from '@/lib/jarvis/use-jarvis'

interface Props {
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>
  readonly size: number
  readonly isListening: boolean
  readonly isConnected: boolean
  readonly jarvisState: JarvisState
  readonly onExpand: () => void
}

/** Badge dot shown in the corner of the mini button — reflects the real-time JARVIS state. */
function StateBadge({ isListening, jarvisState, isConnected }: Pick<Props, 'isListening' | 'jarvisState' | 'isConnected'>) {
  // Priority order: local mic always wins, then JARVIS backend state
  if (isListening) {
    return <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 animate-pulse ring-2 ring-zinc-950" aria-hidden="true" />
  }
  if (jarvisState === 'thinking') {
    return <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-400 animate-pulse ring-2 ring-zinc-950" aria-hidden="true" />
  }
  if (jarvisState === 'speaking') {
    return <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-sky-400 animate-pulse ring-2 ring-zinc-950" aria-hidden="true" />
  }
  if (jarvisState === 'error') {
    return <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 ring-2 ring-zinc-950" aria-hidden="true" />
  }
  if (jarvisState === 'disconnected') {
    return <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-zinc-500 ring-2 ring-zinc-950" aria-hidden="true" />
  }
  if (isConnected) {
    return <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-zinc-950" aria-hidden="true" />
  }
  return null
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
