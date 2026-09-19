import type { TranscriptMessage } from './session-transcript-types'

export type SessionArtifact = {
  title: string
  url?: string
  path?: string
}

export function extractSessionArtifacts(messages: TranscriptMessage[]): SessionArtifact[] {
  const found: SessionArtifact[] = []
  const seen = new Set<string>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'artifact') {
        if (!part.url && !part.path && (!part.title || part.title === 'Artifact')) continue
        const key = part.url || part.path || part.title
        if (!key || seen.has(key)) continue
        seen.add(key)
        found.push({ title: part.title, url: part.url, path: part.path })
      }
      if (part.type === 'tool_use' && part.name === 'Artifact' && part.input.startsWith('http')) {
        if (seen.has(part.input)) continue
        seen.add(part.input)
        found.push({ title: part.label || 'Artifact', url: part.input })
      }
    }
  }
  return found
}

export function latestArtifact(messages: TranscriptMessage[]): SessionArtifact | null {
  const all = extractSessionArtifacts(messages)
  return all[all.length - 1] || null
}
