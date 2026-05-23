import type { SessionTranscriptMessage } from './session-message'

export function shouldShowTimestamp(
  current: SessionTranscriptMessage,
  previous: SessionTranscriptMessage | undefined,
): boolean {
  if (!current.timestamp) return false
  if (!previous?.timestamp) return true
  const gap = new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime()
  return Math.abs(gap) > 30000
}
