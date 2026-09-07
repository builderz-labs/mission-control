'use client'

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react'

/** Within this many pixels of the bottom still counts as sitting at the tail. */
const NEAR_BOTTOM_PX = 48

export interface TailScroll {
  /** True while the container is pinned to its newest content. */
  following: boolean
  /** Re-pin to the bottom, e.g. from a "jump to latest" affordance. */
  jumpToLatest: () => void
}

/**
 * Pins a scroll container to its newest content the way a terminal or a chat
 * thread does: open on the latest message, stay there while more streams in,
 * and stop following the moment the reader scrolls up to read history.
 *
 * `key` identifies the thread. Changing it (opening another session) re-pins to
 * the bottom of the new thread rather than inheriting the previous scroll
 * position or leaving the reader at the very first message.
 */
export function useTailScroll<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { key, count }: { key?: string | null; count: number },
): TailScroll {
  const [following, setFollowing] = useState(true)

  const pin = useCallback(() => {
    const node = ref.current
    if (node) node.scrollTop = node.scrollHeight
  }, [ref])

  const jumpToLatest = useCallback(() => {
    setFollowing(true)
    pin()
  }, [pin])

  // A new thread always opens at its newest message. React flushes this state
  // update before paint, so the pin below re-runs with `following` true.
  useLayoutEffect(() => {
    setFollowing(true)
  }, [key])

  useLayoutEffect(() => {
    if (!following) return
    pin()
    // Markdown, code blocks and images finish laying out after this commit, so
    // pinning once can land short of the real bottom.
    const frame = requestAnimationFrame(pin)
    return () => cancelAnimationFrame(frame)
  }, [key, count, following, pin])

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const onScroll = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight
      setFollowing(distance <= NEAR_BOTTOM_PX)
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [ref])

  return { following, jumpToLatest }
}
