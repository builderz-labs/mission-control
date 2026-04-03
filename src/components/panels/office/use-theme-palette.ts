// Derives the current ThemePalette from the local clock hour.
// Separated from the shell so the large palette literals don't clutter state management.

import { useState, useEffect, useMemo } from 'react'
import type { TimeTheme, ThemePalette } from './office-types'

function hourToTheme(hour: number): TimeTheme {
  if (hour >= 6 && hour < 11) return 'dawn'
  if (hour >= 11 && hour < 17) return 'day'
  if (hour >= 17 && hour < 20) return 'dusk'
  return 'night'
}

function buildPalette(timeTheme: TimeTheme): ThemePalette {
  if (timeTheme === 'dawn') return {
    shell: 'radial-gradient(circle at 20% 10%, rgba(245,158,11,0.25) 0, rgba(15,20,28,0.92) 48%, rgba(7,9,12,1) 100%)',
    gridLine: 'rgba(245,158,11,0.1)', haze: 'radial-gradient(circle at 52% 26%, rgba(245,158,11,0.15), transparent 62%)',
    glow: 'linear-gradient(to bottom, rgba(245,158,11,0.08), transparent 35%, rgba(0,0,0,0.2))', corridor: '#14181e',
    corridorStripe: 'rgba(245,158,11,0.4)',
    atmosphere: 'radial-gradient(circle at 15% 8%, rgba(245,158,11,0.18), transparent 46%), radial-gradient(circle at 82% 18%, rgba(52,211,153,0.1), transparent 40%)',
    shadowVeil: 'linear-gradient(to bottom, rgba(7,9,12,0.15), rgba(7,9,12,0.38))',
    floorFilter: 'hue-rotate(160deg) saturate(0.7) brightness(0.65) contrast(1.1)', spriteFilter: 'hue-rotate(155deg) saturate(0.8) brightness(0.8)',
    roomTone: 'linear-gradient(to bottom right, rgba(245,158,11,0.1), rgba(7,9,12,0.12))', floorOpacityA: 0.7, floorOpacityB: 0.55, accentGlow: 'rgba(245,158,11,0.18)',
  }
  if (timeTheme === 'day') return {
    shell: 'radial-gradient(circle at 20% 12%, rgba(52,211,153,0.2) 0, rgba(15,20,28,0.9) 46%, rgba(7,9,12,1) 100%)',
    gridLine: 'rgba(52,211,153,0.12)', haze: 'radial-gradient(circle at 52% 28%, rgba(52,211,153,0.12), transparent 58%)',
    glow: 'linear-gradient(to bottom, rgba(52,211,153,0.06), transparent 30%, rgba(0,0,0,0.1))', corridor: '#101820',
    corridorStripe: 'rgba(52,211,153,0.35)',
    atmosphere: 'radial-gradient(circle at 18% 5%, rgba(52,211,153,0.14), transparent 45%), radial-gradient(circle at 84% 16%, rgba(34,211,238,0.08), transparent 42%)',
    shadowVeil: 'linear-gradient(to bottom, rgba(7,9,12,0.08), rgba(7,9,12,0.24))',
    floorFilter: 'hue-rotate(165deg) saturate(0.8) brightness(0.75) contrast(1.08)', spriteFilter: 'hue-rotate(158deg) saturate(0.85) brightness(0.85)',
    roomTone: 'linear-gradient(to bottom right, rgba(52,211,153,0.08), rgba(7,9,12,0.08))', floorOpacityA: 0.75, floorOpacityB: 0.6, accentGlow: 'rgba(52,211,153,0.15)',
  }
  if (timeTheme === 'dusk') return {
    shell: 'radial-gradient(circle at 20% 10%, rgba(167,139,250,0.25) 0, rgba(15,20,28,0.92) 47%, rgba(7,9,12,1) 100%)',
    gridLine: 'rgba(167,139,250,0.1)', haze: 'radial-gradient(circle at 48% 30%, rgba(167,139,250,0.12), transparent 62%)',
    glow: 'linear-gradient(to bottom, rgba(167,139,250,0.06), transparent 30%, rgba(0,0,0,0.24))', corridor: '#12141e',
    corridorStripe: 'rgba(167,139,250,0.35)',
    atmosphere: 'radial-gradient(circle at 14% 10%, rgba(167,139,250,0.14), transparent 44%), radial-gradient(circle at 85% 18%, rgba(34,211,238,0.08), transparent 40%)',
    shadowVeil: 'linear-gradient(to bottom, rgba(7,9,12,0.18), rgba(7,9,12,0.42))',
    floorFilter: 'hue-rotate(175deg) saturate(0.65) brightness(0.6) contrast(1.12)', spriteFilter: 'hue-rotate(168deg) saturate(0.75) brightness(0.75)',
    roomTone: 'linear-gradient(to bottom right, rgba(167,139,250,0.08), rgba(7,9,12,0.16))', floorOpacityA: 0.65, floorOpacityB: 0.5, accentGlow: 'rgba(167,139,250,0.14)',
  }
  // night (default)
  return {
    shell: 'radial-gradient(circle at 22% 10%, rgba(34,211,238,0.15) 0, rgba(7,9,12,0.95) 42%, rgba(7,9,12,1) 100%)',
    gridLine: 'rgba(34,211,238,0.08)', haze: 'radial-gradient(circle at 50% 30%, rgba(34,211,238,0.08), transparent 60%)',
    glow: 'linear-gradient(to bottom, rgba(34,211,238,0.04), transparent 30%, rgba(0,0,0,0.24))', corridor: '#0d1420',
    corridorStripe: 'rgba(34,211,238,0.3)',
    atmosphere: 'radial-gradient(circle at 16% 7%, rgba(34,211,238,0.1), transparent 45%), radial-gradient(circle at 82% 15%, rgba(167,139,250,0.08), transparent 42%)',
    shadowVeil: 'linear-gradient(to bottom, rgba(7,9,12,0.34), rgba(7,9,12,0.56))',
    floorFilter: 'hue-rotate(170deg) saturate(0.6) brightness(0.5) contrast(1.2)', spriteFilter: 'hue-rotate(160deg) saturate(0.7) brightness(0.7)',
    roomTone: 'linear-gradient(to bottom right, rgba(34,211,238,0.06), rgba(7,9,12,0.24))', floorOpacityA: 0.6, floorOpacityB: 0.4, accentGlow: 'rgba(34,211,238,0.12)',
  }
}

interface UseThemePaletteResult {
  timeTheme: TimeTheme
  setTimeTheme: (theme: TimeTheme) => void
  themePalette: ThemePalette
}

export function useThemePalette(initialTheme?: TimeTheme): UseThemePaletteResult {
  const [timeTheme, setTimeTheme] = useState<TimeTheme>(initialTheme ?? 'night')

  // Sync theme with the local clock every minute.
  // Only runs once on mount; external overrides via setTimeTheme are respected
  // until the next clock tick (matching original behaviour).
  useEffect(() => {
    const update = () => setTimeTheme(hourToTheme(new Date().getHours()))
    update()
    const interval = setInterval(update, 60_000)
    return () => clearInterval(interval)
  }, [])

  const themePalette = useMemo(() => buildPalette(timeTheme), [timeTheme])

  return { timeTheme, setTimeTheme, themePalette }
}
