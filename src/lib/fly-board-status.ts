export type BoardStatus = 'inbox' | 'in_progress' | 'review' | 'failed'

export function flyJobBoardStatus(state: string): BoardStatus {
  if (state === 'queued') return 'inbox'
  if (state === 'succeeded') return 'review'
  if (state === 'failed' || state === 'cancelled' || state === 'expired') return 'failed'
  return 'in_progress'
}
