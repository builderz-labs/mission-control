'use client'

import type { StateCreator } from 'zustand'
import { getAllModels } from '@/lib/models'

export interface ModelConfig {
  readonly alias: string
  readonly name: string
  readonly provider: string
  readonly description: string
  readonly costPer1kInput: number
  readonly costPer1kOutput: number
  readonly maxContextTokens: number
}

export interface TokenUsage {
  model: string
  sessionId: string
  date: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export interface ModelSlice {
  availableModels: ModelConfig[]
  setAvailableModels: (models: ModelConfig[]) => void

  // Per-session token usage for cost tracking
  tokenUsage: TokenUsage[]
  addTokenUsage: (usage: TokenUsage) => void
  getUsageByModel: (timeframe: 'day' | 'week' | 'month') => Record<string, number>
  getTotalCost: (timeframe: 'day' | 'week' | 'month') => number
}

// Computes the date cutoff for a given timeframe window
function getTimeframeCutoff(timeframe: 'day' | 'week' | 'month'): Date {
  const now = new Date()
  const msPerDay = 24 * 60 * 60 * 1000
  switch (timeframe) {
    case 'day':   return new Date(now.getTime() - msPerDay)
    case 'week':  return new Date(now.getTime() - 7 * msPerDay)
    case 'month': return new Date(now.getTime() - 30 * msPerDay)
    default:      return new Date(0)
  }
}

// Model config and token usage slice — available models and cost tracking
export const createModelSlice: StateCreator<ModelSlice, [], [], ModelSlice> = (set, get) => ({
  availableModels: [...getAllModels()],
  tokenUsage: [],

  setAvailableModels: (models) => set({ availableModels: models }),

  addTokenUsage: (usage) =>
    set((state) => ({
      tokenUsage: [...state.tokenUsage, usage].slice(-2000),
    })),

  getUsageByModel: (timeframe) => {
    const cutoff = getTimeframeCutoff(timeframe)
    return get()
      .tokenUsage
      .filter((u) => new Date(u.date) >= cutoff)
      .reduce<Record<string, number>>((acc, u) => {
        acc[u.model] = (acc[u.model] ?? 0) + u.totalTokens
        return acc
      }, {})
  },

  getTotalCost: (timeframe) => {
    const cutoff = getTimeframeCutoff(timeframe)
    return get()
      .tokenUsage
      .filter((u) => new Date(u.date) >= cutoff)
      .reduce((acc, u) => acc + u.cost, 0)
  },
})
