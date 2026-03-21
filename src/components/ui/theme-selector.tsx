'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

/**
 * ThemeSelector — no-op stub.
 * Operator's Desk is the only theme. This component ensures
 * next-themes stays on 'light' and renders nothing.
 */
export function ThemeSelector() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (mounted && theme !== 'light') {
      setTheme('light')
    }
  }, [mounted, theme, setTheme])

  return null
}
