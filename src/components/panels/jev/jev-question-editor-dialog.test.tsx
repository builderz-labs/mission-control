import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { JevQuestionEditorDialog } from './jev-question-editor-dialog'
import type { QuestionDraft } from './jev-policy-draft'

const initial: QuestionDraft = {
  id: 'release_ready',
  type: 'noul',
  instructions: 'Is this release ready?',
  criteria: '',
  positive: '',
  negative: '',
}

describe('Jev question editor', () => {
  it('exposes an accessible answer-type chooser and type-specific fields', () => {
    render(<JevQuestionEditorDialog initial={initial} existingIds={[]} canDelete={false} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'New question' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Yes \/ No/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText(/What counts as yes/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveAttribute('aria-label', 'Question')

    fireEvent.click(screen.getByRole('radio', { name: /Choose one/ }))
    expect(screen.getByLabelText('Option 1 key')).toBeInTheDocument()
    expect(screen.getByLabelText('Option 2 meaning')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /^Score/ }))
    expect(screen.getByLabelText('Score level 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add level/ })).toBeInTheDocument()
  })

  it('saves a validated yes-or-no question', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<JevQuestionEditorDialog initial={initial} existingIds={[]} canDelete={false} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/What counts as yes/), { target: { value: 'All checks passed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save question' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 'release_ready', type: 'noul', positive: 'All checks passed',
    })))
  })

  it('blocks duplicate result names before updating a policy', async () => {
    const onSave = vi.fn()
    render(<JevQuestionEditorDialog initial={initial} existingIds={['release_ready']} canDelete={false} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save question' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already used')
    expect(onSave).not.toHaveBeenCalled()
  })
})
