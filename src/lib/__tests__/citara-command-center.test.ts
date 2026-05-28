import { describe, expect, it } from 'vitest'
import {
  approvalActionLabel,
  buildBenchmarkOptimizationCards,
  commandCenterHealthLabel,
  formatLastRunnerEvent,
  summarizeCommandCenter,
} from '../citara-command-center'

describe('citara command center helpers', () => {
  it('prioritizes failed tasks over review, running and queue states', () => {
    expect(commandCenterHealthLabel({ failed: 1, quality_review: 3, in_progress: 2, awaiting_owner: 4 })).toEqual({
      tone: 'critical',
      label: 'Atenção',
      description: 'Existem falhas abertas que precisam de correção.',
    })
  })

  it('summarizes the operational state for the Cítara Command Center', () => {
    expect(summarizeCommandCenter({
      agentsReady: 9,
      awaitingOwner: 2,
      inProgress: 1,
      qualityReview: 3,
      failed: 0,
      done: 7,
    })).toEqual([
      '9/9 agentes Cítara prontos',
      '2 tasks aguardando Hermes Adapter',
      '1 task em execução',
      '3 entregas aguardando revisão humana',
      '7 concluídas',
    ])
  })

  it('formats the latest fleet runner event with processed/found counters', () => {
    expect(formatLastRunnerEvent({
      ts: '2026-05-26T22:28:16-0300',
      exit_code: 0,
      elapsed_seconds: 8.4,
      summary: { agents_checked: 9, tasks_found: 4, tasks_processed: 3, errors: [] },
    })).toEqual('2026-05-26T22:28:16-0300 · exit 0 · 3/4 tasks processadas · 9 agentes · 8.4s')
  })

  it('labels approval actions consistently for the review buttons', () => {
    expect(approvalActionLabel('approve')).toEqual({ label: 'Aprovar', tone: 'success' })
    expect(approvalActionLabel('request_changes')).toEqual({ label: 'Pedir ajustes', tone: 'warning' })
    expect(approvalActionLabel('reject')).toEqual({ label: 'Reprovar', tone: 'danger' })
  })

  it('builds one surgical benchmark optimization per external mission control reference', () => {
    const cards = buildBenchmarkOptimizationCards({
      agentsReady: 9,
      awaitingOwner: 2,
      inProgress: 1,
      qualityReview: 1,
      failed: 0,
      done: 6,
      topics: [
        { topic: 'Growth', tasks: { active: 2, review: 1, failed: 0 } },
        { topic: 'Ops', tasks: { active: 0, review: 0, failed: 0 } },
      ],
      clients: [
        { name: 'EMASFI', open: 3, review: 1, failed: 0 },
      ],
      lastRunnerEvent: {
        ts: '2026-05-26T22:28:16-0300',
        exit_code: 0,
        elapsed_seconds: 8.4,
        summary: { agents_checked: 9, tasks_found: 4, tasks_processed: 3, errors: [] },
      },
    })

    expect(cards.map(card => card.source)).toEqual(['Langfuse', 'LangSmith', 'CrewAI', 'AutoGPT', 'Dify', 'Flowise'])
    expect(cards).toHaveLength(6)
    expect(cards.find(card => card.source === 'CrewAI')?.signal).toContain('Growth')
    expect(cards.find(card => card.source === 'Flowise')?.signal).toContain('EMASFI')
    expect(cards.find(card => card.source === 'LangSmith')?.status).toBe('action')
  })
})
