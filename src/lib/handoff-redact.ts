export function redactSecrets(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\bghp_[A-Za-z0-9]{8,}/g, '[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(api[_-]?key|token)[=:]\s*\S+/gi, '$1=[redacted]')
}

export function filesTouched(text: string, limit = 24): string[] {
  const matches = text.match(/(?:\/[\w.@-]+)+\/[\w.-]+\.[\w]+|[\w./-]+\.(?:ts|tsx|js|jsx|md|json|html|sql|yml)/g) || []
  const unique: string[] = []
  for (const match of matches) {
    if (unique.includes(match) || match.includes('node_modules')) continue
    unique.push(match)
    if (unique.length >= limit) break
  }
  return unique
}
