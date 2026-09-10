import { readClaudeTranscript } from './claude-transcript'
import { readCodexTranscript } from './codex-transcript'
import { readGrokTranscript } from './grok-transcript'
import { readKimiTranscript } from './kimi-transcript'
import { readHermesTranscript } from './hermes-transcript'
import { readOpenCodeTranscript } from './opencode-transcript'
import type { TranscriptMessage } from './session-transcript-types'

export function readKindTranscript(kind: string, sessionId: string, limit: number): TranscriptMessage[] {
  if (kind === 'claude-code') return readClaudeTranscript(sessionId, limit)
  if (kind === 'codex-cli') return readCodexTranscript(sessionId, limit)
  if (kind === 'grok') return readGrokTranscript(sessionId, limit)
  if (kind === 'kimi') return readKimiTranscript(sessionId, limit)
  if (kind === 'hermes') return readHermesTranscript(sessionId, limit)
  if (kind === 'opencode') return readOpenCodeTranscript(sessionId, limit)
  return []
}
