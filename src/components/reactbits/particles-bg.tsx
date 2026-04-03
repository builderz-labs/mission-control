'use client'

import { useEffect, useRef, useCallback } from 'react'

interface Particle {
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly size: number
  readonly opacity: number
  readonly color: string
}

interface ParticlesBgProps {
  readonly particleCount?: number
  readonly colors?: readonly string[]
  readonly speed?: number
  readonly connectDistance?: number
  readonly className?: string
}

function createParticle(w: number, h: number, colors: readonly string[]): Particle {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.5,
    vy: (Math.random() - 0.5) * 0.5,
    size: Math.random() * 2 + 0.5,
    opacity: Math.random() * 0.5 + 0.2,
    color: colors[Math.floor(Math.random() * colors.length)],
  }
}

function moveParticle(p: Particle, w: number, h: number, speed: number): Particle {
  let nx = p.x + p.vx * speed
  let ny = p.y + p.vy * speed
  let nvx = p.vx
  let nvy = p.vy

  if (nx < 0 || nx > w) { nvx = -nvx; nx = Math.max(0, Math.min(w, nx)) }
  if (ny < 0 || ny > h) { nvy = -nvy; ny = Math.max(0, Math.min(h, ny)) }

  return { ...p, x: nx, y: ny, vx: nvx, vy: nvy }
}

export default function ParticlesBg({
  particleCount = 80,
  colors = ['#22D3EE', '#3B82F6', '#A78BFA', '#34D399'],
  speed = 1,
  connectDistance = 120,
  className = '',
}: ParticlesBgProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const mouseRef = useRef<{ x: number; y: number }>({ x: -1000, y: -1000 })
  const animIdRef = useRef<number>(0)

  const init = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const w = canvas.width
    const h = canvas.height
    particlesRef.current = Array.from({ length: particleCount }, () =>
      createParticle(w, h, colors)
    )
  }, [particleCount, colors])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (!rect) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)
      init()
    }

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    window.addEventListener('resize', resize)
    canvas.addEventListener('mousemove', handleMouseMove)
    resize()

    const draw = () => {
      const w = canvas.width / (window.devicePixelRatio || 1)
      const h = canvas.height / (window.devicePixelRatio || 1)
      ctx.clearRect(0, 0, w, h)

      // Move particles
      particlesRef.current = particlesRef.current.map(p => moveParticle(p, w, h, speed))

      const particles = particlesRef.current
      const mouse = mouseRef.current

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i]
        // Connect to nearby particles
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < connectDistance) {
            const alpha = (1 - dist / connectDistance) * 0.15
            ctx.strokeStyle = `${a.color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
            ctx.lineWidth = 0.5
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }
        }
        // Connect to mouse
        const mdx = a.x - mouse.x
        const mdy = a.y - mouse.y
        const mdist = Math.sqrt(mdx * mdx + mdy * mdy)
        if (mdist < connectDistance * 1.5) {
          const alpha = (1 - mdist / (connectDistance * 1.5)) * 0.3
          ctx.strokeStyle = `#22D3EE${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
          ctx.lineWidth = 0.8
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(mouse.x, mouse.y)
          ctx.stroke()
        }
      }

      // Draw particles
      for (const p of particles) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `${p.color}${Math.round(p.opacity * 255).toString(16).padStart(2, '0')}`
        ctx.fill()
      }

      animIdRef.current = requestAnimationFrame(draw)
    }

    animIdRef.current = requestAnimationFrame(draw)

    return () => {
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('mousemove', handleMouseMove)
      cancelAnimationFrame(animIdRef.current)
    }
  }, [speed, connectDistance, init])

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-auto ${className}`}
    />
  )
}
