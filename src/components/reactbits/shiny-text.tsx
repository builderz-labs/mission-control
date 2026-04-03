'use client'

import { useRef, useEffect, useState, useCallback } from 'react'

interface ShinyTextProps {
  readonly text: string
  readonly disabled?: boolean
  readonly speed?: number
  readonly className?: string
  readonly color?: string
  readonly shineColor?: string
  readonly spread?: number
  readonly pauseOnHover?: boolean
}

export default function ShinyText({
  text,
  disabled = false,
  speed = 2,
  className = '',
  color = '#b5b5b5a0',
  shineColor = '#22D3EE',
  spread = 120,
  pauseOnHover = false,
}: ShinyTextProps) {
  const spanRef = useRef<HTMLSpanElement>(null)
  const [isPaused, setIsPaused] = useState(false)
  const animRef = useRef<number>(0)
  const progressRef = useRef<number>(0)
  const lastTimeRef = useRef<number | null>(null)

  useEffect(() => {
    if (disabled || !spanRef.current) return

    // Respect prefers-reduced-motion
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    // Reset time tracking when effect re-runs (e.g. pause/unpause)
    lastTimeRef.current = null

    const animationDuration = speed * 1000

    const update = (time: number) => {
      if (!spanRef.current) return

      if (lastTimeRef.current === null) {
        lastTimeRef.current = time
        animRef.current = requestAnimationFrame(update)
        return
      }

      if (!isPaused) {
        const delta = time - lastTimeRef.current
        progressRef.current += delta
      }
      lastTimeRef.current = time

      const cycleDuration = animationDuration + 500
      const cycleTime = progressRef.current % cycleDuration
      const p = cycleTime < animationDuration
        ? (cycleTime / animationDuration) * 100
        : 100

      const bgPos = `${150 - p * 2}% center`
      spanRef.current.style.backgroundPosition = bgPos

      animRef.current = requestAnimationFrame(update)
    }

    animRef.current = requestAnimationFrame(update)
    return () => cancelAnimationFrame(animRef.current)
  }, [disabled, speed, isPaused])

  const handleMouseEnter = useCallback(() => {
    if (pauseOnHover) setIsPaused(true)
  }, [pauseOnHover])

  const handleMouseLeave = useCallback(() => {
    if (pauseOnHover) setIsPaused(false)
  }, [pauseOnHover])

  const style: React.CSSProperties = {
    backgroundImage: `linear-gradient(${spread}deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
    backgroundSize: '200% auto',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  }

  return (
    <span
      ref={spanRef}
      className={`inline-block ${className}`}
      style={style}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {text}
    </span>
  )
}
