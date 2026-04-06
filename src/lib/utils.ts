import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { Session, Agent, AgentStatus } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatUptime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

export function formatAge(ageStr: string): string {
  // Convert age strings like "1h ago", "just now" to consistent format
  if (ageStr === 'just now') return '< 1m'
  if (ageStr.includes('ago')) {
    return ageStr.replace(' ago', '')
  }
  return ageStr
}

export function parseTokenUsage(tokens: string): { used: number; total: number; percentage: number } {
  // Parse token strings like "28k/35k (80%)" or "28/35 (80%)"
  const match = tokens.match(/(\d+(?:\.\d+)?)\s*(k)?\/(\d+(?:\.\d+)?)\s*(k)?\s*\((\d+)%\)/i)
  if (!match) return { used: 0, total: 0, percentage: 0 }

  const used = parseFloat(match[1]) * (match[2] ? 1000 : 1)
  const total = parseFloat(match[3]) * (match[4] ? 1000 : 1)
  const percentage = parseInt(match[5])

  return { used, total, percentage }
}

export function getStatusBadgeColor(status: AgentStatus['status']): string {
  switch (status) {
    case 'active': return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'idle': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'error': return 'bg-red-500/20 text-red-400 border-red-500/30'
    case 'offline': return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
    default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  }
}

/** Normalize model field — OpenClaw 2026.3.x may send {primary: "model-name"} instead of a string */
export function normalizeModel(model: unknown): string {
  if (typeof model === 'string') return model
  if (model && typeof model === 'object' && 'primary' in model) return String((model as { primary: unknown }).primary)
  return ''
}

export function sessionToAgent(session: Session): Agent {
  const getStatusFromSession = (session: Session): AgentStatus['status'] => {
    if (session.age === 'just now' || session.age.includes('m ago')) return 'active'
    if (session.age.includes('h ago')) return 'idle'
    return 'offline'
  }

  return {
    id: session.id,
    name: session.key.split(':').pop() || session.key,
    type: session.kind === 'direct' ? 
      (session.key.includes('subag') ? 'subagent' : 
       session.key.includes('cron') ? 'cron' : 'main') : 'group',
    status: getStatusFromSession(session),
    model: session.model,
    session
  }
}

export function generateNodePosition(index: number, total: number): { x: number; y: number } {
  const angle = (index / total) * 2 * Math.PI
  const radius = Math.min(300, 50 + total * 10)
  return {
    x: 400 + Math.cos(angle) * radius,
    y: 300 + Math.sin(angle) * radius
  }
}