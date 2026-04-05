'use client'

// Encapsulates all animation and movement logic for the office map.
// Keeps the main shell free of the RAF/timer complexity.

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Agent } from '@/store'
import type { MovingWorker, SeatPosition, RenderedWorker, OfficeEvent } from './office-types'
import { toTile, tileKey, buildPath, LOUNGE_WAYPOINTS } from './office-map-constants'
import { getInitials, hashColor, hashNumber, statusLabel } from './office-utils'

interface UseOfficeAnimationsInput {
  readonly displayAgents: Agent[]
  readonly currentSeatMap: Map<number, SeatPosition>
  readonly renderedWorkers: RenderedWorker[]
  readonly pushOfficeEvent: (event: Omit<OfficeEvent, 'id' | 'at'>) => void
  readonly isLocalMode: boolean
  // movingWorkers lives in the shell so useOfficeSeatMap can read it too
  readonly movingWorkers: MovingWorker[]
  readonly setMovingWorkers: React.Dispatch<React.SetStateAction<MovingWorker[]>>
}

export interface UseOfficeAnimationsOutput {
  readonly spriteFrame: number
  readonly transitioningAgentIds: Set<number>
  readonly enqueueMovement: (
    agent: Agent,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    durationMs?: number,
  ) => void
}

export function useOfficeAnimations({
  displayAgents,
  currentSeatMap,
  renderedWorkers,
  pushOfficeEvent,
  isLocalMode,
  movingWorkers,
  setMovingWorkers,
}: UseOfficeAnimationsInput): UseOfficeAnimationsOutput {
  const [spriteFrame, setSpriteFrame] = useState(0)
  const [transitioningAgentIds, setTransitioningAgentIds] = useState<Set<number>>(new Set())

  const transitionTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const roamReturnTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const prevStatusRef = useRef<Map<number, Agent['status']>>(new Map())
  const previousSeatMapRef = useRef<Map<number, SeatPosition>>(new Map())
  const movingAgentIdsRef = useRef<Set<number>>(new Set())
  const movingWorkersRef = useRef<MovingWorker[]>([])
  const renderedWorkersRef = useRef<RenderedWorker[]>([])

  // Keep refs in sync — cheaper than passing mutable state through deps
  useEffect(() => { movingWorkersRef.current = movingWorkers; movingAgentIdsRef.current = new Set(movingWorkers.map((w) => w.agentId)) }, [movingWorkers])
  useEffect(() => { renderedWorkersRef.current = renderedWorkers }, [renderedWorkers])

  const enqueueMovement = useCallback(
    (agent: Agent, startX: number, startY: number, endX: number, endY: number, durationMs = 2200): void => {
      const blockedTiles = new Set<string>()
      for (const worker of renderedWorkersRef.current) {
        if (worker.agent.id === agent.id) continue
        const tile = toTile(worker.x, worker.y)
        blockedTiles.add(tileKey(tile.col, tile.row))
      }
      for (const moving of movingWorkersRef.current) {
        if (moving.agentId === agent.id) continue
        blockedTiles.add(moving.destinationTile)
      }
      const destination = toTile(endX, endY)
      const movement: MovingWorker = {
        id: `${agent.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        agentId: agent.id,
        initials: getInitials(agent.name),
        colorClass: hashColor(agent.name),
        startX, startY, endX, endY,
        startedAt: Date.now(),
        durationMs,
        progress: 0,
        ...buildPath(startX, startY, endX, endY, blockedTiles),
        destinationTile: tileKey(destination.col, destination.row),
      }
      setMovingWorkers((current) => {
        if (current.some((item) => item.agentId === agent.id)) return current
        return [...current, movement]
      })
    },
    [],
  )

  // Sprite animation ticker
  useEffect(() => {
    const interval = setInterval(() => setSpriteFrame((c) => (c + 1) % 2), 380)
    return () => clearInterval(interval)
  }, [])

  // Status-change transition highlight
  useEffect(() => {
    const prev = prevStatusRef.current
    const next = new Map<number, Agent['status']>()
    const toAnimate: number[] = []
    for (const agent of displayAgents) {
      next.set(agent.id, agent.status)
      const prevStatus = prev.get(agent.id)
      if (prevStatus && prevStatus !== agent.status) toAnimate.push(agent.id)
    }
    prevStatusRef.current = next
    if (toAnimate.length === 0) return
    setTransitioningAgentIds((current) => {
      const updated = new Set(current)
      for (const id of toAnimate) updated.add(id)
      return updated
    })
    for (const id of toAnimate) {
      const existing = transitionTimersRef.current.get(id)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        setTransitioningAgentIds((current) => { const updated = new Set(current); updated.delete(id); return updated })
        transitionTimersRef.current.delete(id)
      }, 2200)
      transitionTimersRef.current.set(id, timer)
    }
  }, [displayAgents])

  // Seat-change movement trigger
  useEffect(() => {
    const previous = previousSeatMapRef.current
    for (const agent of displayAgents) {
      const currentSeat = currentSeatMap.get(agent.id)
      const previousSeat = previous.get(agent.id)
      if (!currentSeat || !previousSeat || currentSeat.seatKey === previousSeat.seatKey) continue
      enqueueMovement(agent, previousSeat.x, previousSeat.y, currentSeat.x, currentSeat.y, 1800)
    }
    previousSeatMapRef.current = currentSeatMap
  }, [currentSeatMap, displayAgents, enqueueMovement])

  // RAF-driven movement progress updater
  useEffect(() => {
    if (movingWorkers.length === 0) return
    let rafId: number | null = null
    const step = (): void => {
      const now = Date.now()
      setMovingWorkers((current) => {
        if (current.length === 0) return current
        return current
          .map((w) => ({ ...w, progress: Math.max(0, Math.min(1, (now - w.startedAt) / w.durationMs)) }))
          .filter((w) => w.progress < 1)
      })
      rafId = window.requestAnimationFrame(step)
    }
    rafId = window.requestAnimationFrame(step)
    return () => { if (rafId != null) window.cancelAnimationFrame(rafId) }
  }, [movingWorkers.length])

  // Idle roaming — local mode only
  useEffect(() => {
    if (!isLocalMode) return
    const interval = setInterval(() => {
      const activeMovingIds = movingAgentIdsRef.current
      const idleCandidates = renderedWorkersRef.current
        .filter((w) => w.agent.status === 'idle' && !w.isMoving && !activeMovingIds.has(w.agent.id))
        .sort((a, b) => a.agent.name.localeCompare(b.agent.name))
        .slice(0, 2)
      if (idleCandidates.length === 0) return
      const cycle = Math.floor(Date.now() / 14_000)
      for (const worker of idleCandidates) {
        const waypoint = LOUNGE_WAYPOINTS[(hashNumber(worker.agent.name) + cycle) % LOUNGE_WAYPOINTS.length]
        enqueueMovement(worker.agent, worker.x, worker.y, waypoint.x, waypoint.y, 2200)
        const existingReturnTimer = roamReturnTimersRef.current.get(worker.agent.id)
        if (existingReturnTimer) clearTimeout(existingReturnTimer)
        const returnTimer = setTimeout(() => {
          const seat = currentSeatMap.get(worker.agent.id)
          if (seat) enqueueMovement(worker.agent, waypoint.x, waypoint.y, seat.x, seat.y, 2200)
          roamReturnTimersRef.current.delete(worker.agent.id)
        }, 2700)
        roamReturnTimersRef.current.set(worker.agent.id, returnTimer)
      }
    }, 14_000)
    return () => clearInterval(interval)
  }, [currentSeatMap, enqueueMovement, isLocalMode])

  // Periodic status event ticker
  useEffect(() => {
    const interval = setInterval(() => {
      const workers = renderedWorkersRef.current
      if (workers.length === 0) return
      const sample = workers[Math.floor(Math.random() * workers.length)]
      const mood = sample.agent.status === 'busy' ? 'good' : sample.agent.status === 'idle' ? 'warn' : 'info'
      pushOfficeEvent({ kind: 'room', severity: mood, message: `${sample.zoneLabel}: ${sample.agent.name} status is ${statusLabel[sample.agent.status].toLowerCase()}.` })
    }, 22000)
    return () => clearInterval(interval)
  }, [pushOfficeEvent])

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = transitionTimersRef.current
    const roamTimers = roamReturnTimersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      for (const timer of roamTimers.values()) clearTimeout(timer)
      roamTimers.clear()
    }
  }, [])

  return { spriteFrame, transitioningAgentIds, enqueueMovement }
}
