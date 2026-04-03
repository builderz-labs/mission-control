'use client'

import { useRef, useCallback } from 'react'

interface SpotlightCardProps {
  readonly children: React.ReactNode
  readonly className?: string
  readonly spotlightColor?: string
  readonly spotlightSize?: number
}

export default function SpotlightCard({
  children,
  className = '',
  spotlightColor = 'rgba(34, 211, 238, 0.08)',
  spotlightSize = 300,
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    card.style.setProperty('--spotlight-x', `${x}px`)
    card.style.setProperty('--spotlight-y', `${y}px`)
  }, [])

  const handleMouseLeave = useCallback(() => {
    const card = cardRef.current
    if (!card) return
    card.style.setProperty('--spotlight-x', `-1000px`)
    card.style.setProperty('--spotlight-y', `-1000px`)
  }, [])

  return (
    <div
      ref={cardRef}
      className={`relative overflow-hidden rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        '--spotlight-x': '-1000px',
        '--spotlight-y': '-1000px',
        '--spotlight-color': spotlightColor,
        '--spotlight-size': `${spotlightSize}px`,
      } as React.CSSProperties}
    >
      {/* Spotlight radial gradient overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-300"
        style={{
          background: `radial-gradient(var(--spotlight-size) circle at var(--spotlight-x) var(--spotlight-y), var(--spotlight-color), transparent 80%)`,
        }}
      />
      {/* Content */}
      <div className="relative z-20">{children}</div>
    </div>
  )
}
