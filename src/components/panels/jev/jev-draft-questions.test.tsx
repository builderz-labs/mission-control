import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { JevDraftQuestions } from './jev-draft-questions'

const questions = {
  is_urgent: { type: 'noul', instructions: 'Is urgent action requested?', criteria: { true: 'Immediate action', false: 'Routine request' } },
  category: { type: 'choice', instructions: 'Which request type?', criteria: { bug: 'Bug report', other: 'Anything else' } },
  severity: { type: 'score', instructions: 'How severe?', criteria: ['Low', 'Medium', 'High'] },
}
function Harness() {
  const [schema, setSchema] = useState(JSON.stringify(questions))
  return <><JevDraftQuestions schemaText={schema} disabled={false} onChange={setSchema} /><output data-testid="schema">{schema}</output></>
}

describe('Visual Jev draft questions', () => {
  it('shows every answer type and its autofilled criteria without JSON editing', () => {
    render(<Harness />)
    expect(screen.getByText('Yes / No')).toBeInTheDocument()
    expect(screen.getByText('Category', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('Score')).toBeInTheDocument()
    expect(screen.getByText('Immediate action')).toBeInTheDocument()
    expect(screen.getByText('bug: Bug report')).toBeInTheDocument()
    expect(screen.getByText('3. High')).toBeInTheDocument()
  })
  it('edits a question in place without losing other questions or order', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit is urgent' }))
    fireEvent.change(screen.getByLabelText('Question', { exact: true }), { target: { value: 'Does this require action today?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save question' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const changed = JSON.parse(screen.getByTestId('schema').textContent || '{}')
    expect(changed.is_urgent.instructions).toBe('Does this require action today?')
    expect(changed.category).toEqual(questions.category)
    expect(Object.keys(changed)).toEqual(['is_urgent', 'category', 'severity'])
  })
  it('rejects duplicate question names and makes no change when cancelled', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit is urgent' }))
    fireEvent.change(screen.getByLabelText('Result name'), { target: { value: 'category' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save question' }))
    expect(screen.getByRole('alert')).toHaveTextContent('already used')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(JSON.parse(screen.getByTestId('schema').textContent || '{}')).toEqual(questions)
  })
  it('shows an actionable error for invalid advanced JSON', () => {
    render(<JevDraftQuestions schemaText="{" disabled={false} onChange={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('advanced JSON')
    expect(screen.getByRole('button', { name: 'Add question' })).toBeDisabled()
  })
})
