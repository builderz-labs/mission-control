import { describe, expect, it } from 'vitest'
import { flyJobBoardStatus } from '@/lib/fly-board-status'

describe('flyJobBoardStatus', () => {
  it('maps launch states onto visible board columns', () => {
    expect(flyJobBoardStatus('queued')).toBe('inbox')
    expect(flyJobBoardStatus('creating')).toBe('in_progress')
    expect(flyJobBoardStatus('running')).toBe('in_progress')
    expect(flyJobBoardStatus('cleaning')).toBe('in_progress')
    expect(flyJobBoardStatus('succeeded')).toBe('review')
    expect(flyJobBoardStatus('failed')).toBe('failed')
    expect(flyJobBoardStatus('cancelled')).toBe('failed')
  })
})
