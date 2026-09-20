import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { JevAnswerCards } from './jev-answer-cards'
import { JevWorkbench } from './jev-workbench'
import { JevQuickstart } from './jev-quickstart'
import type { JevPolicy } from './jev-ui-types'

const policy: JevPolicy = {
  id: 7, workspace_id: 1, project_id: 2, name: 'Review gate', description: null,
  model: 'jev-latest', mode: 'shadow', enabled: true, created_by: 'operator',
  created_at: 1, updated_at: 1,
  questions: { decision: { type: 'choice', instructions: 'Choose', criteria: { pass: null, fail: null } } },
}
const context = {
  state: { repository: { name: 'Example' }, structure: { representativeFiles: ['src/app.ts'] } },
  source: 'local' as const, localAvailable: true, includedFiles: ['README.md'],
  trackedFileCount: 1, warnings: [],
}

describe('Jev operator UI', () => {
  it('renders accessible probability summaries for every answer type', () => {
    render(<JevAnswerCards result={{
      id: 'eval', model: 'jev-1.13.0', latencyMs: 42, requestId: 'req',
      usage: { input_tokens: 10, output_tokens: 4 },
      answers: {
        urgent: { type: 'noul', noul: 0.75 },
        decision: { type: 'choice', choice: 'pass', confidence: 0.8, probabilities: { pass: 0.9, fail: 0.1 } },
        quality: { type: 'score', score: 1.2, confidence: 0.7, legend: { 0: 'Low', 1: 'High' }, probabilities: { 0: 0.2, 1: 0.8 } },
      },
    }} />)
    expect(screen.getByText('Evaluation complete')).toBeInTheDocument()
    expect(screen.getAllByRole('progressbar')).toHaveLength(6)
    expect(screen.getByLabelText('No probability')).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText(/jev-1.13.0/)).toBeInTheDocument()
  })

  it('parses structured state before invoking the selected policy', async () => {
    const onRun = vi.fn().mockResolvedValue({
      id: 'eval', model: 'jev-1.13.0', answers: {},
      usage: { input_tokens: 1, output_tokens: 1 }, requestId: null, latencyMs: 10,
    })
    render(<JevWorkbench policies={[policy]} selectedId={7} canRun onSelect={vi.fn()} onRun={onRun} onLoadContext={vi.fn().mockResolvedValue(context)} />)
    fireEvent.change(screen.getByLabelText('Context format'), { target: { value: 'json' } })
    fireEvent.change(screen.getByLabelText('Context Jev will evaluate'), { target: { value: '{"risk":"low"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate with Jev' }))
    expect(await screen.findByText('Evaluation complete')).toBeInTheDocument()
    expect(onRun).toHaveBeenCalledWith(7, { risk: 'low' }, false)
  })

  it('shows invalid JSON as an error without calling the backend', async () => {
    const onRun = vi.fn()
    render(<JevWorkbench policies={[policy]} selectedId={7} canRun onSelect={vi.fn()} onRun={onRun} onLoadContext={vi.fn().mockResolvedValue(context)} />)
    fireEvent.change(screen.getByLabelText('Context format'), { target: { value: 'json' } })
    fireEvent.change(screen.getByLabelText('Context Jev will evaluate'), { target: { value: '{bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate with Jev' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onRun).not.toHaveBeenCalled()
  })

  it('loads a safe repository snapshot into the reviewable context field', async () => {
    const onLoadContext = vi.fn().mockResolvedValue(context)
    render(<JevWorkbench policies={[policy]} selectedId={7} canRun onSelect={vi.fn()} onRun={vi.fn()} onLoadContext={onLoadContext} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load repository context' }))
    expect(await screen.findByText('Context ready.')).toBeInTheDocument()
    expect(String(screen.getByLabelText('Context Jev will evaluate').getAttribute('value') ?? (screen.getByLabelText('Context Jev will evaluate') as HTMLTextAreaElement).value)).toContain('src/app.ts')
  })

  it('keeps evaluation and context loading unavailable to viewers', () => {
    render(<JevWorkbench policies={[policy]} selectedId={7} canRun={false} disabledReason="Operator access is required" onSelect={vi.fn()} onRun={vi.fn()} onLoadContext={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Load repository context' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Operator access is required' })).toBeDisabled()
  })

  it('turns the recommended beginner template into a ready policy', async () => {
    const onCreate = vi.fn().mockResolvedValue(policy)
    const onReady = vi.fn()
    render(<JevQuickstart canCreate onCreate={onCreate} onReady={onReady} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use Release readiness' }))
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(policy))
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Release readiness', mode: 'shadow' }))
  })
})
