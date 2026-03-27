'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { THEMES, isThemeDark } from '@/lib/themes'

export function ThemeBackground() {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Sync the "dark" class on <html> so Tailwind dark: variants work.
  // next-themes applies the theme id as a single class; we add/remove
  // "dark" separately based on the theme's group.
  useEffect(() => {
    if (!mounted || !theme) return
    const el = document.documentElement
    if (isThemeDark(theme)) {
      el.classList.add('dark')
    } else {
      el.classList.remove('dark')
    }
  }, [mounted, theme])

  const meta = THEMES.find(t => t.id === (mounted ? theme : undefined))
  const bgClass = meta?.background

  return (
    <div
      className={`${bgClass ?? ''} fixed inset-0 -z-10 pointer-events-none transition-opacity duration-150 ${mounted && bgClass ? 'opacity-100' : 'opacity-0'}`}
      aria-hidden="true"
    />
  )
}
