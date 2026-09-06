import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ModelPicker } from './model-picker'
import en from '../../../../messages/en.json'

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(async () => ({
    providers: { anthropic: true, openai: true, moonshot: true, xai: true, groq: false },
  })),
}))

function wrap(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('ModelPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists LLMs before models and marks the active engine', async () => {
    const onChange = vi.fn()
    const onEffort = vi.fn()
    const { container } = render(wrap(
      <ModelPicker
        value="opus"
        onChange={onChange}
        fastMode={false}
        onFastMode={() => undefined}
        effort="medium"
        onEffort={onEffort}
        onClose={() => undefined}
      />,
    ))
    expect(screen.getByText('LLMs')).toBeInTheDocument()
    expect(screen.getByText('Models')).toBeInTheDocument()
    expect(screen.getByText('Claude')).toBeInTheDocument()
    expect(screen.getByText('Codex')).toBeInTheDocument()
    expect(screen.getByText('Kimi')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Grok')).toBeInTheDocument())
    expect(container.querySelectorAll('img[src*="/brand/"]').length).toBeGreaterThanOrEqual(8)
    fireEvent.click(screen.getByText('Sonnet 4.6'))
    expect(onChange).toHaveBeenCalledWith('sonnet')
  })

  it('changes effort from the dropdown', async () => {
    const onEffort = vi.fn()
    render(wrap(
      <ModelPicker
        value="opus"
        onChange={() => undefined}
        fastMode={false}
        onFastMode={() => undefined}
        effort="medium"
        onEffort={onEffort}
        onClose={() => undefined}
      />,
    ))
    await waitFor(() => expect(screen.getByLabelText('Effort')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'high' } })
    expect(onEffort).toHaveBeenCalledWith('high')
  })
})
