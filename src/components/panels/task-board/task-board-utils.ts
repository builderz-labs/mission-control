// Pure utility functions and static constants shared across task-board sub-components.
// No React imports — these are plain TS helpers that can be tested independently.

import type { StatusColumn } from './task-board-types'

export const statusColumns: StatusColumn[] = [
  { key: 'inbox', title: 'Inbox', color: 'bg-secondary text-foreground' },
  { key: 'assigned', title: 'Assigned', color: 'bg-blue-500/20 text-blue-400' },
  { key: 'in_progress', title: 'In Progress', color: 'bg-yellow-500/20 text-yellow-400' },
  { key: 'review', title: 'Review', color: 'bg-purple-500/20 text-purple-400' },
  { key: 'quality_review', title: 'Quality Review', color: 'bg-indigo-500/20 text-indigo-400' },
  { key: 'done', title: 'Done', color: 'bg-green-500/20 text-green-400' },
]

export const priorityColors: Record<string, string> = {
  low: 'border-l-green-500',
  medium: 'border-l-yellow-500',
  high: 'border-l-orange-500',
  critical: 'border-l-red-500',
}

/** Returns a human-readable relative time string (e.g. "3 hours ago"). */
export function formatTaskTimestamp(timestamp: number): string {
  const now = Date.now()
  const time = timestamp * 1000
  const diff = now - time

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  return 'just now'
}

/** Maps a tag string to its Tailwind colour classes based on keyword matching. */
export function getTagColor(tag: string): string {
  const lowerTag = tag.toLowerCase()
  if (lowerTag.includes('urgent') || lowerTag.includes('critical')) {
    return 'bg-red-500/20 text-red-400 border-red-500/30'
  }
  if (lowerTag.includes('bug') || lowerTag.includes('fix')) {
    return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
  }
  if (lowerTag.includes('feature') || lowerTag.includes('enhancement')) {
    return 'bg-green-500/20 text-green-400 border-green-500/30'
  }
  if (lowerTag.includes('research') || lowerTag.includes('analysis')) {
    return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
  }
  if (lowerTag.includes('deploy') || lowerTag.includes('release')) {
    return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
  }
  return 'bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20'
}

/** Resolves the display name for a task assignee from the agent list. */
export function getAgentName(agents: { name: string }[], sessionKey?: string): string {
  const agent = agents.find(a => a.name === sessionKey)
  return agent?.name ?? sessionKey ?? 'Unassigned'
}

interface ParsedComment {
  text: string
  meta?: {
    model?: string
    provider?: string
    durationMs?: number
    tokens?: number
  }
}

/**
 * Strips ANSI codes and attempts to parse OpenClaw JSON payloads from comment
 * content. Falls back to cleaned plain text when the content is not JSON.
 */
export function parseCommentContent(raw: string): ParsedComment {
  // Strip ANSI escape codes
  const stripped = raw
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\[3[0-9]m/g, '')
    .replace(/\[39m/g, '')

  // Try to parse as JSON payload (OpenClaw agent result format)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed: any = JSON.parse(stripped)
    if (parsed && typeof parsed === 'object') {
      let text = ''
      let meta: ParsedComment['meta']

      if (Array.isArray(parsed.payloads)) {
        text = parsed.payloads
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((p: any) => (typeof p === 'string' ? p : p?.text || '').trim())
          .filter(Boolean)
          .join('\n')
      }

      if (parsed.meta?.agentMeta) {
        const am = parsed.meta.agentMeta
        meta = {
          model: am.model,
          provider: am.provider,
          durationMs: parsed.meta.durationMs,
          tokens: am.usage?.total,
        }
      }

      if (text) return { text, meta }
    }
  } catch {
    // Not JSON — treat as plain text
  }

  // Clean up any remaining ANSI prefixes from log lines
  const cleaned = stripped
    .split('\n')
    .map(line => line.replace(/^\[[\w/-]+\]\s*/, '').trim())
    .filter(line => line && !line.startsWith('{') && !line.startsWith('"'))
    .join('\n')

  return { text: cleaned || stripped }
}
