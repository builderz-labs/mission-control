'use client'

import { useState, useRef, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { locales, localeNames, type Locale } from '@/i18n/config'
import { Button } from '@/components/ui/button'

function setLocaleCookie(locale: Locale) {
  document.cookie = `NEXT_LOCALE=${locale};path=/;max-age=31536000;SameSite=Lax`
  window.location.reload()
}

/** Popover-style language switcher for the header bar */
export function LanguageSwitcher() {
  const currentLocale = useLocale() as Locale
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  return (
    <div className="relative" ref={ref}>
      <Button
        onClick={() => setOpen(!open)}
        variant="ghost"
        size="icon-sm"
        title="Language"
        aria-label="Language"
      >
        <GlobeIcon />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-44 rounded-lg bg-card border border-border shadow-lg z-50 py-1 overflow-hidden">
            {locales.map((loc) => (
              <Button
                key={loc}
                onClick={() => { setLocaleCookie(loc); setOpen(false) }}
                variant="ghost"
                className={`w-full justify-start px-3 py-1.5 h-auto rounded-none text-sm gap-2.5 ${
                  currentLocale === loc ? 'bg-primary/10 text-foreground' : ''
                }`}
              >
                <span className="flex-1 text-xs text-left">{localeNames[loc]}</span>
                {currentLocale === loc && (
                  <svg className="w-3.5 h-3.5 text-primary shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 8.5l3.5 3.5L13 4" />
                  </svg>
                )}
              </Button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Native select variant for settings panel and login page */
export function LanguageSwitcherSelect() {
  const currentLocale = useLocale() as Locale

  return (
    <select
      value={currentLocale}
      onChange={(e) => setLocaleCookie(e.target.value as Locale)}
      className="h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-smooth"
      aria-label="Language"
    >
      {locales.map((loc) => (
        <option key={loc} value={loc}>
          {localeNames[loc]}
        </option>
      ))}
    </select>
  )
}

function GlobeIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M1.5 8h13" />
      <path d="M8 1.5c1.93 2.13 3 4.47 3 6.5s-1.07 4.37-3 6.5" />
      <path d="M8 1.5c-1.93 2.13-3 4.47-3 6.5s1.07 4.37 3 6.5" />
    </svg>
  )
}
