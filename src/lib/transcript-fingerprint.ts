type FingerprintPart = { type: string; text?: string }

export function transcriptFingerprint(messages: Array<{
  timestamp?: string
  parts: FingerprintPart[]
}>): string {
  const last = messages[messages.length - 1]
  const text = last?.parts.find((part) => part.type === 'text' && part.text)?.text || ''
  return `${messages.length}:${last?.timestamp || ''}:${last?.parts.length || 0}:${text.length}:${text.slice(-24)}`
}
