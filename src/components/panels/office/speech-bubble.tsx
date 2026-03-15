'use client'

// SECURITY: NEVER use dangerouslySetInnerHTML in this component.
// All content must be rendered as React text children only.

import { useState, useEffect, useRef } from 'react'

const STATUS_EMOJI: Record<string, string> = {
  idle: '\u25CB',   // ○
  busy: '\u25CF',   // ●
  error: '\u25B2',  // ▲
  offline: '\u2013', // –
}

const AUTO_DISMISS_MS = 8_000

interface SpeechBubbleProps {
  status: string
  lastActivity?: string
  showText: boolean
  agentColor: string
}

export function SpeechBubble({ status, lastActivity, showText, agentColor }: SpeechBubbleProps) {
  const [visible, setVisible] = useState(false)
  const prevStatusRef = useRef(status)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (prevStatusRef.current !== status) {
      prevStatusRef.current = status
      setVisible(true)

      // Clear any existing timer
      if (timerRef.current) clearTimeout(timerRef.current)

      // Error status stays visible indefinitely
      if (status !== 'error') {
        timerRef.current = setTimeout(() => setVisible(false), AUTO_DISMISS_MS)
      }
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [status])

  if (!visible) return null

  const emoji = STATUS_EMOJI[status] ?? STATUS_EMOJI.idle
  const isError = status === 'error'
  const bgColor = isError ? '#f38ba8' : `${agentColor}cc`

  const text =
    showText && lastActivity
      ? `${emoji} ${lastActivity.length > 60 ? lastActivity.slice(0, 60) + '\u2026' : lastActivity}`
      : emoji

  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 z-10"
      style={{ bottom: '100%', marginBottom: 6 }}
    >
      <div
        className="relative rounded-md px-2 py-1 text-[10px] text-white max-w-[160px] truncate shadow-lg"
        style={{
          backgroundColor: bgColor,
          animation: 'mcBubbleFadeIn 200ms ease-out',
        }}
      >
        {text}
        {/* Triangle pointer */}
        <span
          className="absolute left-1/2 -translate-x-1/2"
          style={{
            top: '100%',
            width: 0,
            height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: `5px solid ${bgColor}`,
          }}
        />
      </div>
    </div>
  )
}
