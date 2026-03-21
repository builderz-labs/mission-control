'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState, useRef } from 'react'
import { THEMES } from '@/lib/themes'
import { Button } from '@/components/ui/button'

export function ThemeSelector() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Force light-only surface; keep legacy theme names inert
  useEffect(() => {
    if (mounted && theme === 'dark') {
      setTheme('light')
    }
  }, [mounted, theme, setTheme])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!mounted) {
    return <div className="w-8 h-8 rounded-md bg-secondary animate-pulse" />
  }

  const lightThemes = THEMES.filter(t => t.group === 'light')

  return (
    <div className="relative" ref={ref}>
      <Button
        onClick={() => setOpen(!open)}
        variant="ghost"
        size="icon-sm"
        title="Change theme"
      >
        <PaletteIcon />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-52 rounded-2xl bg-card border border-border shadow-[0_18px_40px_hsl(28_18%_18%_/_0.10)] z-50 py-1 overflow-hidden">
            <div className="px-3 py-1.5">
              <span className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Light</span>
            </div>
            {lightThemes.map(t => (
              <ThemeRow
                key={t.id}
                meta={t}
                active={theme === t.id}
                onSelect={() => { setTheme(t.id); setOpen(false) }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ThemeRow({ meta, active, onSelect }: { meta: typeof THEMES[number]; active: boolean; onSelect: () => void }) {
  return (
    <Button
      onClick={onSelect}
      variant="ghost"
      className={`w-full justify-start px-3 py-1.5 h-auto rounded-none text-sm gap-2.5 ${
        active
          ? 'bg-primary/10 text-foreground font-medium'
          : ''
      }`}
    >
      <span
        className="w-3.5 h-3.5 rounded-full border border-border/50 shrink-0"
        style={{ backgroundColor: meta.swatch }}
      />
      <span className="flex-1 text-xs text-left">{meta.label}</span>
      {active && (
        <svg className="w-3.5 h-3.5 text-primary shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8.5l3.5 3.5L13 4" />
        </svg>
      )}
    </Button>
  )
}

function PaletteIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <circle cx="6" cy="5.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="5.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="8.5" r="1" fill="currentColor" stroke="none" />
      <path d="M10 9.5c0 1.1-.9 2-2 2s-2-.9-2-2" />
    </svg>
  )
}
