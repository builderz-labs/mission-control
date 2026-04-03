'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

interface CountUpProps {
  readonly from?: number
  readonly to: number
  readonly duration?: number
  readonly className?: string
  readonly separator?: string
  readonly decimals?: number
  readonly prefix?: string
  readonly suffix?: string
}

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

export default function CountUp({
  from = 0,
  to,
  duration = 2,
  className = '',
  separator = ',',
  decimals = 0,
  prefix = '',
  suffix = '',
}: CountUpProps) {
  const [value, setValue] = useState<number>(from)
  const [hasStarted, setHasStarted] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  const formatNumber = useCallback(
    (num: number): string => {
      const fixed = num.toFixed(decimals)
      if (!separator) return `${prefix}${fixed}${suffix}`
      const [intPart, decPart] = fixed.split('.')
      const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, separator)
      return `${prefix}${decPart ? `${formatted}.${decPart}` : formatted}${suffix}`
    },
    [separator, decimals, prefix, suffix]
  )

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !hasStarted) {
          setHasStarted(true)
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasStarted])

  useEffect(() => {
    if (!hasStarted) return

    // Respect prefers-reduced-motion
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(to)
      return
    }

    const startTime = performance.now()
    const durationMs = duration * 1000
    let frameId: number

    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / durationMs, 1)
      const easedProgress = easeOutExpo(progress)
      const current = from + (to - from) * easedProgress
      setValue(current)

      if (progress < 1) {
        frameId = requestAnimationFrame(animate)
      }
    }

    frameId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frameId)
  }, [hasStarted, from, to, duration])

  return (
    <span ref={ref} className={className}>
      {formatNumber(value)}
    </span>
  )
}
