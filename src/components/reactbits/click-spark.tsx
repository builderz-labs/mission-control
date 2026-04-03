'use client'

import { useEffect, useRef, useCallback } from 'react'

interface ClickSparkProps {
  readonly children: React.ReactNode
  readonly sparkColor?: string
  readonly sparkCount?: number
  readonly sparkSize?: number
  readonly duration?: number
}

interface Spark {
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly life: number
  readonly maxLife: number
  readonly size: number
}

/**
 * Wraps children with a click-to-spark effect.
 * On click, sparks radiate outward from the click point.
 */
export default function ClickSpark({
  children,
  sparkColor = '#22D3EE',
  sparkCount = 8,
  sparkSize = 4,
  duration = 400,
}: ClickSparkProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sparksRef = useRef<Spark[]>([])
  const animRef = useRef<number>(0)
  const isAnimatingRef = useRef(false)

  const startAnimation = useCallback(() => {
    if (isAnimatingRef.current) return
    isAnimatingRef.current = true

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = canvas.width / dpr
    const h = canvas.height / dpr

    const draw = () => {
      ctx.clearRect(0, 0, w, h)

      sparksRef.current = sparksRef.current
        .map(s => ({
          ...s,
          x: s.x + s.vx,
          y: s.y + s.vy,
          vy: s.vy + 0.1, // gravity
          life: s.life - 1,
        }))
        .filter(s => s.life > 0)

      for (const s of sparksRef.current) {
        const alpha = s.life / s.maxLife
        ctx.globalAlpha = alpha
        ctx.fillStyle = sparkColor
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size * alpha, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      if (sparksRef.current.length > 0) {
        animRef.current = requestAnimationFrame(draw)
      } else {
        isAnimatingRef.current = false
      }
    }

    animRef.current = requestAnimationFrame(draw)
  }, [sparkColor])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const maxLife = Math.round(duration / 16)

      const newSparks: Spark[] = Array.from({ length: sparkCount }, () => {
        const angle = Math.random() * Math.PI * 2
        const velocity = 2 + Math.random() * 4
        return {
          x,
          y,
          vx: Math.cos(angle) * velocity,
          vy: Math.sin(angle) * velocity - 2,
          life: maxLife,
          maxLife,
          size: sparkSize * (0.5 + Math.random() * 0.5),
        }
      })

      sparksRef.current = [...sparksRef.current, ...newSparks]
      startAnimation()
    },
    [sparkCount, sparkSize, duration, startAnimation]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const resize = () => {
      const rect = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.scale(dpr, dpr)
      }
    }

    resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animRef.current)
    }
  }, [])

  return (
    <div ref={containerRef} className="relative" onClick={handleClick}>
      {children}
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 z-50"
      />
    </div>
  )
}
