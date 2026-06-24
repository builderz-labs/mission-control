import { useEffect, useRef, useCallback } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * Traps keyboard focus within a container element.
 * Handles Tab/Shift+Tab cycling and Escape to close.
 */
export function useFocusTrap(onClose?: () => void) {
  const containerRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation()
        onClose()
        return
      }

      if (e.key !== 'Tab') return

      const container = containerRef.current
      if (!container) return

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      )

      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    },
    [onClose]
  )

  // Mount-only: capture the previously-focused element, move focus into the
  // container once, and restore focus on unmount. This must NOT depend on
  // handleKeyDown — otherwise an unstable onClose (e.g. recreated on every SSE
  // re-render of the parent) would re-run this effect and steal focus back to
  // the first field while the user is typing in a later one (issue #673).
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement

    const container = containerRef.current
    if (container) {
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusable.length > 0) {
        focusable[0].focus()
      }
    }

    return () => {
      previousFocusRef.current?.focus()
    }
  }, [])

  // Keydown listener is rebound whenever the handler identity changes. Rebinding
  // is cheap and side-effect-free, so re-running this on SSE updates is harmless.
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])

  return containerRef
}
