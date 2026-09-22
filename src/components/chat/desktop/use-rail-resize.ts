'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  clampRailWidth,
  RAIL_DEFAULT,
  readStoredRailWidth,
  writeStoredRailWidth,
} from '@/lib/rail-width'

export function useRailResize(userId: number | string | undefined) {
  const [width, setWidth] = useState(RAIL_DEFAULT)
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    setWidth(readStoredRailWidth(userId))
  }, [userId])

  useEffect(() => {
    const onResize = () => setWidth((current) => clampRailWidth(current, window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const persist = useCallback((next: number) => {
    const clamped = clampRailWidth(next, window.innerWidth)
    setWidth(clamped)
    writeStoredRailWidth(userId, clamped)
    return clamped
  }, [userId])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (!active || event.pointerId !== active.pointerId) return
    setWidth(clampRailWidth(active.startWidth + event.clientX - active.startX, window.innerWidth))
  }, [])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (!active || event.pointerId !== active.pointerId) return
    drag.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    persist(active.startWidth + event.clientX - active.startX)
  }, [persist])

  const handleProps = {
    role: 'separator' as const,
    tabIndex: 0,
    'aria-orientation': 'vertical' as const,
    'aria-valuenow': width,
    'aria-valuemin': 200,
    'aria-label': 'Resize project list',
    'aria-valuemax': 480,
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onDoubleClick: () => persist(RAIL_DEFAULT),
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      persist(width + (event.key === 'ArrowRight' ? 16 : -16))
    },
  }

  return { width, handleProps }
}
