'use client'

import { useEffect, useState } from 'react'

/**
 * ThemeBackground — ensures dark class is never present.
 * Operator's Desk is light-only, no themed backgrounds.
 */
export function ThemeBackground() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (mounted) {
      document.documentElement.classList.remove('dark')
    }
  }, [mounted])

  return null
}
