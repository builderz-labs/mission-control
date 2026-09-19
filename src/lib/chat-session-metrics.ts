import { MODEL_CATALOG } from './models'

export const DEFAULT_CONTEXT_WINDOW = 200_000

export type SessionTokenMetrics = {
  used: number
  window: number
  percent: number
  label: string
}

const ZERO_METRICS: SessionTokenMetrics = { used: 0, window: 0, percent: 0, label: '0' }

export function parseTokenCount(raw: string): number {
  const match = raw.trim().toLowerCase().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)([kmb])?$/)
  if (!match) return 0
  const value = Number(match[1])
  if (!Number.isFinite(value)) return 0
  if (match[2] === 'k') return Math.round(value * 1_000)
  if (match[2] === 'm') return Math.round(value * 1_000_000)
  if (match[2] === 'b') return Math.round(value * 1_000_000_000)
  return Math.round(value)
}

export function parseSessionTokens(tokens: string | undefined): SessionTokenMetrics {
  if (!tokens?.trim()) return ZERO_METRICS
  const explicit = readExplicitPercent(tokens)
  const parts = splitTokenParts(tokens)
  if (parts.length === 0) return ZERO_METRICS
  const left = parseTokenCount(parts[0])
  const right = parts[1] ? parseTokenCount(parts[1]) : 0
  if (isInOutPair(left, right, explicit != null)) {
    return metrics(left + right, DEFAULT_CONTEXT_WINDOW, explicit, `${formatTokenLabel(left)}/${formatTokenLabel(right)}`)
  }
  if (parts.length >= 2) return metrics(left, right, explicit)
  return metrics(left, 0, explicit)
}

export function formatTokenLabel(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1_000_000) return `${trimDecimal(n / 1_000_000)}m`
  if (n >= 1_000) return `${trimDecimal(n / 1_000)}k`
  return String(Math.round(n))
}

export function sessionDurationMs(startTime?: number, lastActivity?: number, now = Date.now()): number {
  const start = toMs(startTime)
  if (!start) return 0
  const end = lastActivity ? toMs(lastActivity) : now
  return Math.max(0, end - start)
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return '0m'
  const mins = Math.floor(ms / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`
  if (hours > 0) return mins % 60 ? `${hours}h ${mins % 60}m` : `${hours}h`
  return `${mins}m`
}

export function contextPercent(tokens?: string, model?: string): number | null {
  if (!tokens?.trim()) return null
  const parsed = parseSessionTokens(tokens)
  const explicit = readExplicitPercent(tokens)
  if (explicit != null) return explicit
  const window = isInOutTokens(tokens) ? modelContextWindow(model) : parsed.window
  if (window <= 0) return null
  const percent = Math.round((parsed.used / window) * 100)
  if (!Number.isFinite(percent) || percent > 150) return null
  return Math.min(100, Math.max(0, percent))
}

function splitTokenParts(tokens: string): string[] {
  return tokens.replace(/\(.*\)/, '').split('/').map((part) => part.trim()).filter(Boolean)
}

function isInOutPair(left: number, right: number, hasPercent: boolean): boolean {
  return !hasPercent && right > 0 && left > right
}

function isInOutTokens(tokens: string): boolean {
  const parts = splitTokenParts(tokens)
  if (parts.length < 2) return false
  return isInOutPair(parseTokenCount(parts[0]), parseTokenCount(parts[1]), readExplicitPercent(tokens) != null)
}

function metrics(used: number, window: number, explicit: number | null, label?: string): SessionTokenMetrics {
  const percent = explicit != null ? explicit : window > 0 ? Math.round((used / window) * 100) : 0
  return { used, window, percent, label: label ?? formatTokenLabel(used) }
}

function readExplicitPercent(tokens: string): number | null {
  const match = tokens.match(/\((\d+(?:\.\d+)?)%\)/)
  return match ? Number(match[1]) : null
}

function modelContextWindow(model?: string): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW
  const hay = model.trim().toLowerCase()
  const match = MODEL_CATALOG.find((entry) => {
    const name = entry.name.toLowerCase()
    const short = name.slice(name.indexOf('/') + 1)
    return hay === entry.alias || hay === name || hay.includes(name) || hay.includes(short)
  })
  return match?.contextWindow || DEFAULT_CONTEXT_WINDOW
}

function toMs(value?: number): number {
  if (!value) return 0
  if (value > 1_000_000_000_000) return value
  if (value > 1_000_000_000) return value * 1000
  return value
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}
