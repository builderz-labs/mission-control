/**
 * memory-service-wrapper.ts — Thin ESM→CJS bridge.
 *
 * Canonical memory write logic lives in scripts/memory-service.cjs.
 * All production code (coordinator, CLI, API routes) must go through
 * that file. This wrapper makes the CJS functions callable from
 * TypeScript / Next.js server code via createRequire.
 *
 * Usage in API routes:
 *   import { writeMemory, recallMemory } from '@/lib/server/memory-service-wrapper'
 */

import { createRequire } from 'node:module'

const _load = createRequire(import.meta.url)
// 3 levels up: src/lib/server/ → src/lib/ → src/ → root → scripts/
const _svc = _load('../../../scripts/memory-service.cjs') as {
  writeMemory:    (source: string, category: string, content: string, meta?: Record<string, unknown>) => { id: number }
  queryMemory:    (searchTerm: string, filters?: { source?: string; category?: string }) => unknown[]
  memoryStatus:   () => unknown
  recallMemory:   (agent: string, taskId: string, prompt: string, limit?: number) => unknown[]
  markOutcome:    (id: number, outcome: string) => { id: number; outcome: string; updated: boolean }
  buildContext:   (recall: unknown[]) => { successfulPatterns: unknown[]; failedPatterns: unknown[]; neutralContext: unknown[] }
  buildExecutionPrompt: (prompt: string, context: Record<string, unknown[]>) => string
  classifyOutcome:(result: Record<string, unknown>) => { suggested_outcome: string; suggestion_reason: string }
  getPendingOutcomes: (limit?: number) => unknown[]
  getOutcomeSuggestion: (id: number) => { id: number; suggested_outcome: string } | null
  approveOutcomes:(filter?: string | null) => { total_processed: number; total_applied: number; breakdown: Record<string, number> }
}

export const writeMemory            = _svc.writeMemory
export const queryMemory            = _svc.queryMemory
export const memoryStatus           = _svc.memoryStatus
export const recallMemory           = _svc.recallMemory
export const markOutcome            = _svc.markOutcome
export const buildContext           = _svc.buildContext
export const buildExecutionPrompt   = _svc.buildExecutionPrompt
export const classifyOutcome        = _svc.classifyOutcome
export const getPendingOutcomes     = _svc.getPendingOutcomes
export const getOutcomeSuggestion   = _svc.getOutcomeSuggestion
export const approveOutcomes        = _svc.approveOutcomes
