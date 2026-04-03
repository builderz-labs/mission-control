/**
 * Design tokens for Ultron Mission Control "Void" aesthetic.
 * Server-safe — no 'use client' directive needed.
 *
 * Use the `hsl()` helper when you need inline styles (ReactFlow nodes, recharts),
 * and reference CSS variables via Tailwind classes everywhere else.
 */

// ---------------------------------------------------------------------------
// HSL triplet type
// ---------------------------------------------------------------------------
export interface HSL {
  h: number
  s: number
  l: number
}

// ---------------------------------------------------------------------------
// Void palette
// ---------------------------------------------------------------------------
export const voidPalette = {
  background: { h: 215, s: 27, l: 4 },   // #07090C — deepest void
  card:       { h: 220, s: 30, l: 8 },    // #0F141C
  primary:    { h: 187, s: 82, l: 53 },   // #22D3EE — cyan
  secondary:  { h: 220, s: 25, l: 11 },
  muted:      { h: 220, s: 20, l: 14 },
  border:     { h: 220, s: 20, l: 14 },
  ring:       { h: 187, s: 82, l: 53 },
} as const satisfies Record<string, HSL>

export const voidAccents = {
  cyan:    { h: 187, s: 82, l: 53 },  // #22D3EE
  mint:    { h: 160, s: 60, l: 52 },  // #34D399
  amber:   { h: 38,  s: 92, l: 50 },  // #F59E0B
  violet:  { h: 263, s: 90, l: 66 },  // #A78BFA
  crimson: { h: 0,   s: 72, l: 51 },  // #DC2626
} as const satisfies Record<string, HSL>

export const statusColors = {
  success: { h: 160, s: 60, l: 52 },  // mint
  warning: { h: 38,  s: 92, l: 50 },  // amber
  error:   { h: 0,   s: 72, l: 51 },  // crimson
  info:    { h: 187, s: 82, l: 53 },  // cyan
} as const satisfies Record<string, HSL>

export const surfaces = {
  0: { h: 215, s: 27, l: 4 },   // deepest void
  1: { h: 222, s: 35, l: 7 },   // dark navy
  2: { h: 220, s: 30, l: 10 },
  3: { h: 220, s: 25, l: 14 },
} as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert an HSL triplet to a CSS `hsl(...)` string. */
export function hsl(color: HSL, alpha?: number): string {
  if (alpha !== undefined) {
    return `hsl(${color.h} ${color.s}% ${color.l}% / ${alpha})`
  }
  return `hsl(${color.h} ${color.s}% ${color.l}%)`
}

/** Return the raw HSL string for a CSS variable value (no `hsl()` wrapper). */
export function hslRaw(color: HSL): string {
  return `${color.h} ${color.s}% ${color.l}%`
}

// ---------------------------------------------------------------------------
// Spacing, radius & typography constants
// ---------------------------------------------------------------------------
export const spacing = {
  unit: 4,          // base grid unit in px
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const

export const radius = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  full: 9999,
} as const

export const fonts = {
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
} as const
