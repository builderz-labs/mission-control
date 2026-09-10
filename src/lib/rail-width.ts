export const RAIL_MIN = 200
export const RAIL_MAX = 480
export const RAIL_DEFAULT = 256
export const RAIL_MAIN_MIN = 360

export function railStorageKey(userId: number | string | undefined): string {
  return `mc.chat-desktop.railWidth.${userId ?? 'anon'}`
}

export function clampRailWidth(width: number, viewportWidth = 1280): number {
  const max = Math.min(RAIL_MAX, Math.max(RAIL_MIN, viewportWidth - RAIL_MAIN_MIN))
  if (!Number.isFinite(width)) return Math.min(RAIL_DEFAULT, max)
  return Math.min(max, Math.max(RAIL_MIN, Math.round(width)))
}

export function readStoredRailWidth(userId: number | string | undefined): number {
  if (typeof window === 'undefined') return RAIL_DEFAULT
  const raw = window.localStorage.getItem(railStorageKey(userId))
  const parsed = raw == null || raw === '' ? RAIL_DEFAULT : Number(raw)
  return clampRailWidth(parsed, window.innerWidth)
}

export function writeStoredRailWidth(userId: number | string | undefined, width: number): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(railStorageKey(userId), String(clampRailWidth(width, window.innerWidth)))
}
