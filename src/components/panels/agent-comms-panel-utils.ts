// Pure utility functions for transforming raw data into FeedEvents.
// Each function is a read-only mapping — no mutations.

import type { LogEntry } from '@/store'
import type { AggregateEvent } from '@/app/api/sessions/transcript/aggregate/route'
import {
  AGENT_IDENTITY,
  type AgentIdentity,
  type ActivityRecord,
  type CommsMessage,
  type FeedCategory,
  type FeedEvent,
} from './agent-comms-panel-types'

// ── Identity helpers ──

export function getIdentity(name: string): AgentIdentity {
  return AGENT_IDENTITY[name.toLowerCase()] ?? {
    color: '#9ca3af',
    emoji: name.charAt(0).toUpperCase(),
    label: name.charAt(0).toUpperCase() + name.slice(1),
  }
}

export function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── Data → FeedEvent transformers ──

export function logsToFeed(logs: LogEntry[]): FeedEvent[] {
  return logs.map(log => {
    const src = (log.source || '').toLowerCase()
    const msg = (log.message || '').toLowerCase()

    let category: FeedCategory = 'trace'
    if (src === 'gateway' || src === 'websocket') {
      if (msg.includes('tool') || msg.includes('spawn')) category = 'tools'
      else if (log.level === 'error' || msg.includes('security') || msg.includes('blocked')) category = 'safety'
      // else remains 'trace'
    } else if (msg.includes('safety') || msg.includes('blocked') || msg.includes('injection')) {
      category = 'safety'
    } else if (msg.includes('tool')) {
      category = 'tools'
    }

    return {
      id: log.id,
      ts: log.timestamp,
      category,
      source: log.source || 'system',
      message: log.message,
      level: log.level,
      data: log.data,
    } satisfies FeedEvent
  })
}

export function commsToFeed(messages: CommsMessage[]): FeedEvent[] {
  return messages.map(msg => {
    const isToolCall = msg.message_type === 'tool_call' || Boolean((msg.metadata as Record<string, unknown>)?.toolName)
    const toId = getIdentity(msg.to_agent)
    const meta = msg.metadata as Record<string, unknown> | null

    return {
      id: `comms-${msg.id}`,
      ts: msg.created_at * 1000,
      category: isToolCall ? 'tools' : 'chat',
      source: msg.from_agent,
      message: isToolCall
        ? `tool: ${String(meta?.toolName ?? msg.content)}`
        : `@${toId.label} ${msg.content}`,
      data: msg.metadata,
    } satisfies FeedEvent
  })
}

export function transcriptToFeed(events: AggregateEvent[]): FeedEvent[] {
  return events.map(e => {
    let category: FeedCategory = 'chat'
    if (e.type === 'tool_use' || e.type === 'tool_result') category = 'tools'
    else if (e.type === 'thinking') category = 'trace'
    else if (e.role === 'system') category = 'system'

    const message =
      e.type === 'tool_use'    ? `tool: ${e.content}`
      : e.type === 'tool_result' ? `result: ${e.content}`
      : e.type === 'thinking'    ? `[thinking] ${e.content}`
      : e.content

    return {
      id: e.id,
      ts: e.ts,
      category,
      source: e.agentName,
      message,
      data: e.metadata,
    } satisfies FeedEvent
  })
}

export function activitiesToFeed(activities: ActivityRecord[]): FeedEvent[] {
  return activities.map(a => ({
    id: `activity-${a.id}`,
    ts: a.created_at * 1000,
    category: 'system' as FeedCategory,
    source: a.actor || 'system',
    message: a.description || a.type,
    level: 'info' as const,
    data: a.data,
  } satisfies FeedEvent))
}

// ── Feed merge + dedup helper ──

export function mergeFeedEvents(...feeds: FeedEvent[][]): FeedEvent[] {
  const merged = feeds.flat()
  const seen = new Set<string>()
  const deduped = merged.filter(e => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })
  return [...deduped].sort((a, b) => a.ts - b.ts)
}
