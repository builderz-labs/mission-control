'use client'

import { useLocale } from 'next-intl'
import { useTransition } from 'react'
import { locales, localeNames, type Locale } from '@/i18n/config'

interface LanguageSwitcherProps {
  onLocaleChange?: (locale: Locale) => void
  compact?: boolean
}

export function LanguageSwitcher({ onLocaleChange, compact = false }: LanguageSwitcherProps) {
  const locale = useLocale() as Locale
  const [isPending, startTransition] = useTransition()

  const handleChange = (newLocale: Locale) => {
    if (newLocale === locale) return
    
    startTransition(() => {
      // Set cookie for locale preference
      document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=31536000`
      onLocaleChange?.(newLocale)
      // Reload to apply new locale
      window.location.reload()
    })
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {locales.map((loc) => (
          <button
            key={loc}
            onClick={() => handleChange(loc)}
            disabled={isPending}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              locale === loc
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-secondary text-muted-foreground'
            }`}
          >
            {loc.toUpperCase()}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Language:</span>
      <div className="flex items-center gap-1 bg-secondary rounded-lg p-1">
        {locales.map((loc) => (
          <button
            key={loc}
            onClick={() => handleChange(loc)}
            disabled={isPending}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              locale === loc
                ? 'bg-primary text-primary-foreground font-medium'
                : 'hover:bg-background text-muted-foreground'
            }`}
          >
            {localeNames[loc]}
          </button>
        ))}
      </div>
    </div>
  )
}