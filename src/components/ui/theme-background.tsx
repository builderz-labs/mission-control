'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'

/**
 * ThemeBackground — applies dark/light class based on current theme.
 * Dark is default for Mission Control.
 */
export function ThemeBackground() {
  const [mounted, setMounted] = useState(false)
  const { theme } = useTheme()

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!mounted) return
    const root = document.documentElement
    if (theme === 'light') {
      root.classList.remove('dark')
      root.classList.add('light')
    } else {
      root.classList.remove('light')
      root.classList.add('dark')
    }
  }, [mounted, theme])

  return null
}
