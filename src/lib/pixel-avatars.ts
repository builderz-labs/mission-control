// Pixel-art avatar definitions for 7 Jarvis agents
// Each avatar is a 16x16 grid rendered via box-shadow or canvas

export interface PixelAvatarDef {
  id: string
  displayName: string
  accentColor: string
  gridSize: number // always 16
  frames: [number, number, string][][] // [frame0, frame1]
}

// Palette constants
const SKIN = '#f4c89a'
const SKIN_SHADOW = '#d4956b'
const HAIR = '#3d2c1f'
const OUTLINE = '#2a1f14'
const EYE = '#2a1f14'
const WHITE = '#ffffff'
const PANTS = '#3a3a5c'
const SHOE = '#2a1f14'

// ── Base body template (shared silhouette) ──
// Head rows 2-5, body rows 6-9, legs rows 10-12, feet row 13
// This returns the "frame 0" (arms down) base body
function baseBody(shirtColor: string): [number, number, string][] {
  const pixels: [number, number, string][] = []

  // -- Hair / top of head (row 2) --
  pixels.push([6, 2, HAIR], [7, 2, HAIR], [8, 2, HAIR], [9, 2, HAIR])

  // -- Head outline + skin (row 3) --
  pixels.push([5, 3, OUTLINE], [6, 3, SKIN], [7, 3, SKIN], [8, 3, SKIN], [9, 3, SKIN], [10, 3, OUTLINE])

  // -- Face: eyes (row 4) --
  pixels.push([5, 4, OUTLINE], [6, 4, SKIN], [7, 4, EYE], [8, 4, SKIN], [9, 4, EYE], [10, 4, SKIN], [11, 4, OUTLINE])

  // -- Face: mouth area (row 5) --
  pixels.push([5, 5, OUTLINE], [6, 5, SKIN], [7, 5, SKIN], [8, 5, SKIN_SHADOW], [9, 5, SKIN], [10, 5, SKIN], [11, 5, OUTLINE])

  // -- Neck (row 6) --
  pixels.push([7, 6, SKIN_SHADOW], [8, 6, SKIN_SHADOW])

  // -- Shoulders + shirt (row 7) --
  pixels.push(
    [4, 7, shirtColor], [5, 7, shirtColor], [6, 7, shirtColor], [7, 7, shirtColor],
    [8, 7, shirtColor], [9, 7, shirtColor], [10, 7, shirtColor], [11, 7, shirtColor]
  )

  // -- Arms + torso (row 8) --
  pixels.push(
    [3, 8, SKIN], [4, 8, shirtColor], [5, 8, shirtColor], [6, 8, shirtColor],
    [7, 8, shirtColor], [8, 8, shirtColor], [9, 8, shirtColor], [10, 8, shirtColor],
    [11, 8, shirtColor], [12, 8, SKIN]
  )

  // -- Arms + torso (row 9) --
  pixels.push(
    [3, 9, SKIN], [4, 9, shirtColor], [5, 9, shirtColor], [6, 9, shirtColor],
    [7, 9, shirtColor], [8, 9, shirtColor], [9, 9, shirtColor], [10, 9, shirtColor],
    [11, 9, shirtColor], [12, 9, SKIN]
  )

  // -- Waist (row 10) --
  pixels.push(
    [5, 10, PANTS], [6, 10, PANTS], [7, 10, PANTS],
    [8, 10, PANTS], [9, 10, PANTS], [10, 10, PANTS]
  )

  // -- Legs (row 11) --
  pixels.push(
    [5, 11, PANTS], [6, 11, PANTS], [7, 11, PANTS],
    [8, 11, PANTS], [9, 11, PANTS], [10, 11, PANTS]
  )

  // -- Lower legs (row 12) --
  pixels.push([6, 12, PANTS], [7, 12, PANTS], [8, 12, PANTS], [9, 12, PANTS])

  // -- Feet (row 13) --
  pixels.push([5, 13, SHOE], [6, 13, SHOE], [9, 13, SHOE], [10, 13, SHOE])

  return pixels
}

// Frame 1: arms raised (typing) — move arm pixels up by 1
function baseBodyTyping(shirtColor: string): [number, number, string][] {
  const pixels = baseBody(shirtColor)
  return pixels.map(([x, y, c]) => {
    // Left arm pixels (col 3, rows 8-9) → move up 1
    if (x === 3 && (y === 8 || y === 9)) return [x, y - 1, c]
    // Right arm pixels (col 12, rows 8-9) → move up 1
    if (x === 12 && (y === 8 || y === 9)) return [x, y - 1, c]
    return [x, y, c]
  })
}

// Helper to add pixels on top of base, overriding by position
function overlay(base: [number, number, string][], extra: [number, number, string][]): [number, number, string][] {
  const map = new Map<string, [number, number, string]>()
  for (const p of base) map.set(`${p[0]},${p[1]}`, p)
  for (const p of extra) map.set(`${p[0]},${p[1]}`, p)
  return Array.from(map.values())
}

// Helper to remove pixels at specific positions
function removeAt(base: [number, number, string][], positions: [number, number][]): [number, number, string][] {
  const removeSet = new Set(positions.map(([x, y]) => `${x},${y}`))
  return base.filter(([x, y]) => !removeSet.has(`${x},${y}`))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Agent-specific avatar customizations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 1. Dev (jarvis-dev) — Blue hoodie, headphones arc on head
function devExtras(): [number, number, string][] {
  const BLUE = '#3b82f6'
  const HEADPHONE = '#4a4a4a'
  return [
    // Headphones arc on top of head
    [5, 1, HEADPHONE], [6, 1, HEADPHONE], [9, 1, HEADPHONE], [10, 1, HEADPHONE],
    [4, 2, HEADPHONE], [11, 2, HEADPHONE],
    // Headphone ear cups
    [4, 3, HEADPHONE], [4, 4, HEADPHONE], [11, 3, HEADPHONE], [11, 4, HEADPHONE],
    // Hoodie hood pixels
    [5, 6, BLUE], [6, 6, BLUE], [9, 6, BLUE], [10, 6, BLUE],
  ]
}

// 2. Mira (jarvis-life) — Pink hijab covering head
function miraExtras(): [number, number, string][] {
  const PINK = '#ec4899'
  const PINK_DARK = '#be185d'
  return [
    // Hijab covers top of head and wraps around
    [5, 1, PINK], [6, 1, PINK], [7, 1, PINK], [8, 1, PINK], [9, 1, PINK], [10, 1, PINK],
    [4, 2, PINK], [5, 2, PINK], [6, 2, PINK], [7, 2, PINK], [8, 2, PINK], [9, 2, PINK], [10, 2, PINK], [11, 2, PINK],
    [4, 3, PINK], [5, 3, PINK_DARK], // left side wrap
    [10, 3, PINK_DARK], [11, 3, PINK],
    [4, 4, PINK],
    [11, 4, PINK],
    [4, 5, PINK], [5, 5, PINK_DARK],
    [10, 5, PINK_DARK], [11, 5, PINK],
    // Drape below chin
    [5, 6, PINK], [6, 6, PINK], [7, 6, PINK_DARK], [8, 6, PINK_DARK], [9, 6, PINK], [10, 6, PINK],
    [4, 6, PINK],
    [11, 6, PINK],
  ]
}

// 3. Friday — Green suit, small glasses (2 pixels)
function fridayExtras(): [number, number, string][] {
  const GLASSES = '#c0c0c0'
  return [
    // Small glasses on eyes row
    [6, 4, GLASSES], [7, 4, GLASSES], [8, 4, GLASSES], [9, 4, GLASSES], [10, 4, GLASSES],
  ]
}

// 4. Zayd (bnb-hero) — Amber polo, darker chin pixels for stubble
function zaydExtras(): [number, number, string][] {
  const STUBBLE = '#6b4c2a'
  return [
    // Stubble on chin/mouth area
    [6, 5, STUBBLE], [7, 5, STUBBLE], [8, 5, STUBBLE], [9, 5, STUBBLE], [10, 5, STUBBLE],
  ]
}

// 5. SukuQi — Violet thobe (longer shirt), kufi cap
function sukuqiExtras(): [number, number, string][] {
  const VIOLET = '#8b5cf6'
  const KUFI = '#6d28d9'
  return [
    // Kufi cap on top of head
    [6, 1, KUFI], [7, 1, KUFI], [8, 1, KUFI], [9, 1, KUFI],
    [5, 2, KUFI], [6, 2, KUFI], [7, 2, KUFI], [8, 2, KUFI], [9, 2, KUFI], [10, 2, KUFI],
    // Thobe extends down over pants area
    [5, 10, VIOLET], [6, 10, VIOLET], [7, 10, VIOLET],
    [8, 10, VIOLET], [9, 10, VIOLET], [10, 10, VIOLET],
    [5, 11, VIOLET], [6, 11, VIOLET], [7, 11, VIOLET],
    [8, 11, VIOLET], [9, 11, VIOLET], [10, 11, VIOLET],
  ]
}

// 6. Scout (hostai-scout) — Cyan vest over shirt
function scoutExtras(): [number, number, string][] {
  const VEST = '#06b6d4'
  const VEST_DARK = '#0891b2'
  return [
    // Vest over shirt (rows 7-9, inner columns)
    [5, 7, VEST], [6, 7, VEST], [9, 7, VEST], [10, 7, VEST],
    [5, 8, VEST_DARK], [6, 8, VEST], [9, 8, VEST], [10, 8, VEST_DARK],
    [5, 9, VEST_DARK], [6, 9, VEST], [9, 9, VEST], [10, 9, VEST_DARK],
  ]
}

// 7. Aegis — Red shield emblem on chest
function aegisExtras(): [number, number, string][] {
  const RED = '#ef4444'
  const RED_DARK = '#b91c1c'
  return [
    // Shield emblem on chest (rows 7-9, center)
    [7, 7, RED], [8, 7, RED],
    [7, 8, RED_DARK], [8, 8, RED_DARK],
    [7, 9, RED],
  ]
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Build final avatar definitions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function makeAvatar(
  id: string,
  displayName: string,
  accentColor: string,
  shirtColor: string,
  extrasFn: () => [number, number, string][],
): PixelAvatarDef {
  const extras = extrasFn()
  const frame0 = overlay(baseBody(shirtColor), extras)
  const frame1 = overlay(baseBodyTyping(shirtColor), extras)
  return {
    id,
    displayName,
    accentColor,
    gridSize: 16,
    frames: [frame0, frame1],
  }
}

export const AGENT_AVATARS: Record<string, PixelAvatarDef> = {
  'jarvis-dev': makeAvatar('jarvis-dev', 'Dev', '#3b82f6', '#3b82f6', devExtras),
  'jarvis-life': makeAvatar('jarvis-life', 'Mira', '#ec4899', '#ec4899', miraExtras),
  'friday': makeAvatar('friday', 'Friday', '#10b981', '#10b981', fridayExtras),
  'bnb-hero': makeAvatar('bnb-hero', 'Zayd', '#f59e0b', '#f59e0b', zaydExtras),
  'sukuqi': makeAvatar('sukuqi', 'SukuQi', '#8b5cf6', '#8b5cf6', sukuqiExtras),
  'hostai-scout': makeAvatar('hostai-scout', 'Scout', '#06b6d4', '#0e7490', scoutExtras),
  'aegis': makeAvatar('aegis', 'Aegis', '#ef4444', '#ef4444', aegisExtras),
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Rendering utilities
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Build a CSS box-shadow string from pixel data.
 * Each pixel becomes a `Xpx Ypx 0 0 color` shadow on a 1x1 element.
 */
export function buildBoxShadow(pixels: [number, number, string][], scale: number): string {
  return pixels
    .map(([x, y, color]) => `${x * scale}px ${y * scale}px 0 0 ${color}`)
    .join(',')
}

/**
 * Look up an avatar by agent name (fuzzy: checks id and displayName).
 */
export function getAvatarForAgent(agentName: string): PixelAvatarDef | null {
  const lower = agentName.toLowerCase()
  // Direct match by id
  if (AGENT_AVATARS[lower]) return AGENT_AVATARS[lower]
  // Match by display name
  for (const av of Object.values(AGENT_AVATARS)) {
    if (av.displayName.toLowerCase() === lower) return av
  }
  // Partial match
  for (const av of Object.values(AGENT_AVATARS)) {
    if (av.id.includes(lower) || lower.includes(av.id)) return av
    if (av.displayName.toLowerCase().includes(lower) || lower.includes(av.displayName.toLowerCase())) return av
  }
  return null
}

/**
 * Render an avatar frame to an HTMLCanvasElement at the specified target size.
 */
export function renderAvatarToCanvas(
  def: PixelAvatarDef,
  targetSize: number,
  frame: number = 0,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = targetSize
  canvas.height = targetSize
  const ctx = canvas.getContext('2d')!
  const scale = targetSize / def.gridSize

  const pixels = def.frames[frame] || def.frames[0]
  for (const [x, y, color] of pixels) {
    ctx.fillStyle = color
    ctx.fillRect(
      Math.floor(x * scale),
      Math.floor(y * scale),
      Math.ceil(scale),
      Math.ceil(scale),
    )
  }
  return canvas
}
