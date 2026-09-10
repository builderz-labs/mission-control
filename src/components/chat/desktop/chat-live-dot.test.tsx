import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatLiveDot } from './chat-live-dot'

describe('ChatLiveDot', () => {
  it('marks every row and animates when live', () => {
    const { rerender } = render(<ChatLiveDot live={false} label="Idle" />)
    const idle = screen.getByRole('status', { name: 'Idle' })
    expect(idle.className).not.toContain('pulse-dot')
    rerender(<ChatLiveDot live label="Active" />)
    expect(screen.getByRole('status', { name: 'Active' }).className).toContain('pulse-dot')
  })
})
