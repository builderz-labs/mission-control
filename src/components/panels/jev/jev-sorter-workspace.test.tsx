import { webcrypto } from 'node:crypto'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JevSorterWorkspace } from './jev-sorter-workspace'
import { sorterEvaluation, sorterPolicy } from './jev-sorter.fixtures'

const result = { id: 'eval', model: 'jev-1.13.0', answers: sorterEvaluation().answers ?? {},
  usage: { input_tokens: 10, output_tokens: 3 }, requestId: null, latencyMs: 42 }
const props = () => ({ policies: [sorterPolicy], selectedId: 7, evaluations: [],
  visibleQuestionIds: new Set(['ready', 'kind', 'quality']), canRun: true, canManage: true,
  onSelect: vi.fn(), onRefresh: vi.fn().mockResolvedValue(true), onAssistant: vi.fn(), onToggleQuestion: vi.fn(),
  onEditQuestion: vi.fn(), onAddQuestion: vi.fn(), onRun: vi.fn().mockResolvedValue(result),
  onLoadContext: vi.fn().mockResolvedValue({ state: { synthetic: true }, warnings: [] }),
})
async function prepare(value = 'Synthetic evidence') {
  fireEvent.change(screen.getByLabelText('Context Jev will evaluate'), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Prepare dataset' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '▷ Run 1' })).toBeEnabled())
}
beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('Jev screenshot-style workspace', () => {
  it('restores real result cards, filters and exposes all scope choices', () => {
    render(<JevSorterWorkspace {...props()} evaluations={[sorterEvaluation()]} />)
    expect(screen.getByRole('region', { name: 'Jev dataset results' })).toBeInTheDocument()
    expect(screen.getByText('Average 2.6 of 3')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Run scope')).getAllByRole('option')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Ready: Yes, 1 items' }))
    expect(screen.getByRole('button', { name: 'Clear Ready filter' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Yes probability threshold'), { target: { value: '90' } })
    expect(screen.getByRole('button', { name: 'Ready: No, 1 items' })).toBeInTheDocument()
    expect(screen.getByText('0 results')).toBeInTheDocument()
  })
  it('requires a reviewed preparation and never sends on import or refresh', async () => {
    const input = props(); render(<JevSorterWorkspace {...input} />)
    await prepare()
    expect(input.onRun).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '▷ Run 1' }))
    await screen.findByText(/Evaluation complete/)
    expect(input.onRun).toHaveBeenCalledWith(7, 'Synthetic evidence', false)
    expect(screen.getByRole('button', { name: '▷ Run' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '↻ Refresh' }))
    await waitFor(() => expect(input.onRefresh).toHaveBeenCalledOnce())
    expect(input.onRun).toHaveBeenCalledOnce()
  })
  it('clears previous evidence and stops queued work when changing setup', async () => {
    let resolve: (value: typeof result) => void = () => {}
    const input = props(); input.onRun.mockImplementation(() => new Promise((done) => { resolve = done }))
    const view = render(<JevSorterWorkspace {...input} />)
    await prepare(); fireEvent.click(screen.getByRole('button', { name: '▷ Run 1' }))
    expect(screen.getByLabelText('Context Jev will evaluate')).toBeDisabled()
    view.rerender(<JevSorterWorkspace {...input} selectedId={8} policies={[{ ...sorterPolicy, id: 8 }]} />)
    await act(async () => resolve(result))
    expect(screen.getByLabelText('Context Jev will evaluate')).toHaveValue('')
    expect(screen.queryByText(/Evaluation complete/)).not.toBeInTheDocument()
    expect(screen.getByText('0 results')).toBeInTheDocument()
  })
  it('validates JSON without requests and leaves viewers read-only', async () => {
    const input = props(); const view = render(<JevSorterWorkspace {...input} />)
    fireEvent.change(screen.getByLabelText('Context format'), { target: { value: 'dataset' } })
    fireEvent.change(screen.getByLabelText('Context Jev will evaluate'), { target: { value: '[null]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare dataset' }))
    await screen.findByRole('alert'); expect(input.onRun).not.toHaveBeenCalled()
    view.rerender(<JevSorterWorkspace {...input} canRun={false} canManage={false} disabledReason="Operator access required" />)
    expect(screen.getByLabelText('Context Jev will evaluate')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Edit Ready' })).not.toBeInTheDocument()
  })
  it('does not replay an ambiguous provider failure automatically', async () => {
    const input = props(); input.onRun.mockRejectedValue(new Error('private provider detail'))
    render(<JevSorterWorkspace {...input} />); await prepare()
    fireEvent.click(screen.getByRole('button', { name: '▷ Run 1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh before retrying')
    expect(screen.queryByText(/private provider detail/)).not.toBeInTheDocument()
    expect(input.onRun).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '▷ Run 1' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '↻ Refresh' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '▷ Run 1' })).toBeEnabled())
  })
  it('stops paced batches after the current item and retains completed results', async () => {
    const input = props(); render(<JevSorterWorkspace {...input} />)
    fireEvent.change(screen.getByLabelText('Context format'), { target: { value: 'dataset' } })
    fireEvent.change(screen.getByLabelText('Context Jev will evaluate'), { target: { value: '["one","two"]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare dataset' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '▷ Run 2' })).toBeEnabled())
    vi.useFakeTimers()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '▷ Run 2' })))
    expect(input.onRun).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Stop after current item' }))
    await act(async () => vi.advanceTimersByTimeAsync(6500))
    expect(input.onRun).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '▷ Run 1' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Ready: Yes, 1 items' })).toBeInTheDocument()
  })
})
