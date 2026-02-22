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
  // Parse token strings like "28k/35k (80%)"
  const match = tokens.match(/(\d+)k?\/(\d+)k?\s*\((\d+)%\)/)
  if (!match) return { used: 0, total: 0, percentage: 0 }
  
  const used = parseInt(match[1]) * (match[1].includes('k') ? 1000 : 1)
  const total = parseInt(match[2]) * (match[2].includes('k') ? 1000 : 1)
  const percentage = parseInt(match[3])
  
  return { used, total, percentage }
}

export function getStatusColor(status: AgentStatus['status']): string {
  switch (status) {
    case 'active': return 'text-green-500'
    case 'idle': return 'text-yellow-500'
    case 'error': return 'text-red-500'
    case 'offline': return 'text-gray-500'
    default: return 'text-gray-500'
  }
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