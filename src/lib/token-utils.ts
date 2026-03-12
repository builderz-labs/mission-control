export function detectProvider(model: string): string {
  const lower = model.toLowerCase()
  if (lower.includes('claude') || lower.includes('anthropic')) return 'Anthropic'
  if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3') || lower.includes('o4') || lower.includes('openai')) return 'OpenAI'
  if (lower.includes('gemini') || lower.includes('google')) return 'Google'
  if (lower.includes('mistral') || lower.includes('mixtral')) return 'Mistral'
  if (lower.includes('venice')) return 'Venice AI'
  if (lower.includes('llama') || lower.includes('meta')) return 'Meta'
  if (lower.includes('deepseek')) return 'DeepSeek'
  if (lower.includes('command') || lower.includes('cohere')) return 'Cohere'
  return 'Other'
}

export function generateCsvContent(data: Array<Record<string, unknown>>, columns: string[]): string {
  const escapeField = (value: unknown): string => {
    const str = String(value ?? '')
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const rows: string[] = [columns.join(',')]
  for (const row of data) {
    rows.push(columns.map(col => escapeField(row[col])).join(','))
  }
  return rows.join('\n')
}

export function applyTimezoneOffset(timestamp: string, offsetHours: number): string {
  const date = new Date(timestamp)
  const adjusted = new Date(date.getTime() + offsetHours * 3600000)
  return adjusted.toISOString()
}
