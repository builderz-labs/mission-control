type PlanPart = { type: string; text?: string }

export function extractPlanMarkdown(
  messages: Array<{ role: string; parts: PlanPart[] }>,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const text = message.parts
      .filter((part) => part.type === 'text' && part.text)
      .map((part) => part.text || '')
      .join('\n')
      .trim()
    if (text.length > 120 && /^(#{1,3}\s|When you say go)/m.test(text)) return text
  }
  return null
}
