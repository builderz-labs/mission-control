'use client'

import { useCallback, useEffect, useState } from 'react'

export interface UseCommandBarReturn {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

/**
 * Manages global command bar open/close state.
 * Registers Cmd+K / Ctrl+K keyboard shortcut on mount.
 * Designed to be used as a singleton at the layout level.
 */
export function useCommandBar(): UseCommandBarReturn {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback((): void => setIsOpen(true), [])
  const close = useCallback((): void => setIsOpen(false), [])
  const toggle = useCallback((): void => setIsOpen(prev => !prev), [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // Skip when typing in form elements
      const target = e.target as HTMLElement | null
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggle()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggle])

  return { isOpen, open, close, toggle }
}
