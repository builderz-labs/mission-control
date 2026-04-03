// Pure formatting utilities for token dashboard — no React, no side effects

import type { TimezoneOption } from './types'

export function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toString()
}

export function formatCost(cost: number): string {
  return '$' + cost.toFixed(4)
}

export function getModelDisplayName(modelName: string): string {
  const parts = modelName.split('/')
  return parts[parts.length - 1] || modelName
}

export function formatTimestamp(isoString: string, timezone: TimezoneOption): string {
  const date = new Date(isoString)
  if (isNaN(timezone.offset)) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000
  const adjusted = new Date(utcMs + timezone.offset * 3600000)
  return adjusted.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
