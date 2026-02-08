'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useMissionControl } from '@/store'

interface SmartPollOptions {
  /** Pause polling when WebSocket is connected (data comes via WS anyway) */
  pauseWhenConnected?: boolean
  /** Pause polling when WebSocket is disconnected (no point polling if server is down) */
  pauseWhenDisconnected?: boolean
  /** Pause polling when SSE is connected (real-time events replace polling) */
  pauseWhenSseConnected?: boolean
  /** Enable interval backoff when callback signals no new data */
  backoff?: boolean
  /** Maximum backoff multiplier (default: 3x) */
  maxBackoffMultiplier?: number
  /** Only poll when this returns true */
  enabled?: boolean
}

/**
 * Visibility-aware polling hook that pauses when the browser tab is hidden
 * and resumes immediately when the tab becomes visible again.
 *
 * Returns a function to manually trigger an immediate poll.
 */
export function useSmartPoll(
  callback: () => void | Promise<void>,
  intervalMs: number,
  options: SmartPollOptions = {}
) {
  const {
    pauseWhenConnected = false,
    pauseWhenDisconnected = false,
    pauseWhenSseConnected = false,
    backoff = false,
    maxBackoffMultiplier = 3,
    enabled = true,
  } = options

  const callbackRef = useRef(callback)
  const intervalRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const backoffMultiplierRef = useRef(1)
  const isVisibleRef = useRef(true)

  const { connection } = useMissionControl()

  // Keep callback ref current without re-triggering the effect
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  // Determine if polling should be active
  const shouldPoll = useCallback(() => {
    if (!enabled) return false
    if (!isVisibleRef.current) return false
    if (pauseWhenConnected && connection.isConnected) return false
    if (pauseWhenDisconnected && !connection.isConnected) return false
    if (pauseWhenSseConnected && connection.sseConnected) return false
    return true
  }, [enabled, pauseWhenConnected, pauseWhenDisconnected, pauseWhenSseConnected, connection.isConnected, connection.sseConnected])

  const fire = useCallback(() => {
    if (!shouldPoll()) return
    const result = callbackRef.current()
    // If backoff is enabled and callback returns a promise, we could track
    // "no new data" signals in the future. For now, backoff resets on visibility change.
    if (result instanceof Promise) {
      result.catch(() => {
        // Increase backoff on error
        if (backoff) {
          backoffMultiplierRef.current = Math.min(
            backoffMultiplierRef.current + 0.5,
            maxBackoffMultiplier
          )
        }
      })
    }
  }, [shouldPoll, backoff, maxBackoffMultiplier])

  const startInterval = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (!shouldPoll()) return

    const effectiveInterval = backoff
      ? intervalMs * backoffMultiplierRef.current
      : intervalMs

    intervalRef.current = setInterval(() => {
      if (shouldPoll()) {
        callbackRef.current()
      }
    }, effectiveInterval)
  }, [intervalMs, shouldPoll, backoff])

  // Main effect: set up polling + visibility listener
  useEffect(() => {
    // Initial fire
    fire()
    startInterval()

    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === 'visible'

      if (isVisibleRef.current) {
        // Tab became visible: fire immediately, reset backoff, restart interval
        backoffMultiplierRef.current = 1
        fire()
        startInterval()
      } else {
        // Tab hidden: stop polling
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = undefined
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = undefined
      }
    }
  }, [fire, startInterval])

  // Restart interval when connection state changes (WS or SSE)
  useEffect(() => {
    startInterval()
  }, [connection.isConnected, connection.sseConnected, startInterval])

  // Return manual trigger
  return fire
}
