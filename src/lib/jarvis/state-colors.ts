import type { JarvisState } from './use-jarvis'

/**
 * Single source of truth for JARVIS state colours.
 * WHY: The orb (three-orb.ts BASE_COLOR), the expanded panel border/glow,
 * and the mini-button badge all read from this map — if you change a colour
 * here it propagates everywhere automatically.
 *
 * RGB values are intentionally kept as comma-separated strings so callers
 * can interpolate them directly into `rgba(${rgb}, 0.25)` inline styles
 * without re-parsing a hex value at runtime.
 */
export const JARVIS_STATE_COLORS: Record<JarvisState, { rgb: string; hex: string }> = {
  idle:         { rgb: '76, 168, 232',  hex: '#4ca8e8' },
  listening:    { rgb: '0, 212, 255',   hex: '#00d4ff' },
  thinking:     { rgb: '129, 140, 248', hex: '#818cf8' },
  speaking:     { rgb: '52, 211, 153',  hex: '#34d399' },
  disconnected: { rgb: '113, 113, 122', hex: '#71717a' },
  error:        { rgb: '239, 68, 68',   hex: '#ef4444' },
}
