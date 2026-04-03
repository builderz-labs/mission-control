// Shared pure utility functions for the office panel.
// All functions are stateless and side-effect-free.

import type { Agent } from '@/store'
import type { SessionAgentRow, WorkerVariant } from './office-types'
import { WORKER_VARIANTS } from './office-map-constants'

// ─── Status display maps ──────────────────────────────────────────────────────

export const statusGlow: Record<string, string> = {
  idle: 'shadow-[0_0_12px_hsl(var(--void-mint)/0.3)] border-void-mint/60',
  busy: 'shadow-[0_0_12px_hsl(var(--void-amber)/0.3)] border-void-amber/60',
  error: 'shadow-[0_0_12px_hsl(var(--void-crimson)/0.3)] border-void-crimson/60',
  offline: 'shadow-[0_0_8px_hsl(var(--border)/0.2)] border-border/40',
}

export const statusDot: Record<string, string> = {
  idle: 'bg-void-mint',
  busy: 'bg-void-amber',
  error: 'bg-void-crimson',
  offline: 'bg-muted-foreground/40',
}

export const statusLabel: Record<string, string> = {
  idle: 'Standby',
  busy: 'Active',
  error: 'Alert',
  offline: 'Offline',
}

export const statusEmoji: Record<string, string> = {
  idle: '',
  busy: '',
  error: '',
  offline: '',
}

// ─── String / name helpers ────────────────────────────────────────────────────

export function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function hashColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const colors = [
    'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600',
    'bg-rose-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-teal-600',
    'bg-orange-600', 'bg-pink-600', 'bg-lime-600', 'bg-fuchsia-600',
  ]
  return colors[Math.abs(hash) % colors.length]
}

export function hashNumber(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash)
}

export function formatLastSeen(ts?: number): string {
  if (!ts) return 'Never seen'
  const diff = Date.now() - ts * 1000
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function getStatusEmote(status: Agent['status']): string {
  if (status === 'busy') return '\u25CF'  // filled circle
  if (status === 'idle') return '\u25CB'  // open circle
  if (status === 'error') return '\u25B2'  // triangle
  return '\u2013'                          // dash
}

// ─── Animation helpers ────────────────────────────────────────────────────────

export function easeInOut(progress: number): number {
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  return progress < 0.5
    ? 2 * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 2) / 2
}

// ─── Sprite / variant helpers ─────────────────────────────────────────────────

export const HERO_SHEET_COLS = 6
export const HERO_SHEET_ROWS = 7

export function getWorkerHeroFrame(
  status: Agent['status'],
  isMoving: boolean,
  frame: number,
): { col: number; row: number } {
  const phase = frame % 2
  const walkCol = phase === 0 ? 1 : 3
  if (isMoving) return { col: walkCol, row: 3 }         // side-walk row
  if (status === 'busy') return { col: walkCol, row: 0 } // forward loop as typing proxy
  if (status === 'error') return { col: 5, row: 6 }
  return { col: phase === 0 ? 0 : 5, row: 0 }           // idle pulse
}

export function getWorkerVariant(name: string): WorkerVariant {
  return WORKER_VARIANTS[hashNumber(name) % WORKER_VARIANTS.length]
}

export function getPropSprite(propId: string): string {
  if (propId === 'desk-a' || propId === 'desk-b' || propId === 'desk-e' || propId === 'desk-f') {
    return '/office-sprites/kenney/desk.png'
  }
  if (propId.startsWith('desk-')) return '/office-sprites/kenney/tableCross.png'
  if (propId === 'plant-l') return '/office-sprites/kenney/plantSmall1.png'
  if (propId === 'plant-r') return '/office-sprites/kenney/plantSmall2.png'
  if (propId === 'kitchen') return '/office-sprites/kenney/rugRectangle.png'
  return ''
}

// ─── Local-session inference ──────────────────────────────────────────────────

export function inferLocalRole(row: SessionAgentRow): string {
  const context = [
    String(row.agent || ''),
    String(row.key || ''),
    String(row.workingDir || ''),
    String(row.kind || ''),
  ].join(' ').toLowerCase()

  if (/frontend|ui|ux|design|landing|web/.test(context)) return 'frontend-engineer'
  if (/backend|api|server|platform|infra|ops|sre|deploy|k8s|docker/.test(context)) return 'ops-engineer'
  if (/research|science|ml|ai|llm|data|analytics/.test(context)) return 'research-analyst'
  if (/qa|test|e2e|spec|validation/.test(context)) return 'qa-engineer'
  if (/product|pm|roadmap|strategy/.test(context)) return 'product-manager'
  if (/codex|claude|agent/.test(context)) return 'software-engineer'
  return row.kind || 'local-session'
}

export function isInactiveLocalSession(agent: Agent): boolean {
  return Boolean((agent.config as Record<string, unknown>)?.localSession) && agent.status !== 'busy'
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
