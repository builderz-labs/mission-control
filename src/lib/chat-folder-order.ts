export function parseFolderOrder(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return uniqueStrings(parsed)
  } catch {
    return []
  }
}

export function mergeFolderOrder(order: string[], keys: string[]): string[] {
  const allowed = new Set(keys)
  const result = uniqueStrings(order.filter((key) => allowed.has(key)))
  const seen = new Set(result)
  for (const key of keys) {
    if (seen.has(key)) continue
    seen.add(key)
    result.push(key)
  }
  return result
}

export function moveFolder(order: string[], fromKey: string, toKey: string): string[] {
  const from = order.indexOf(fromKey)
  const to = order.indexOf(toKey)
  if (from < 0 || to < 0 || from === to) return [...order]
  const next = [...order]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function applyFolderOrder<T extends { key: string }>(rows: T[], order: string[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  const byKey = new Map(rows.map((row) => [row.key, row]))
  for (const key of order) {
    const row = byKey.get(key)
    if (!row || seen.has(key)) continue
    result.push(row)
    seen.add(key)
  }
  for (const row of rows) {
    if (seen.has(row.key)) continue
    result.push(row)
    seen.add(row.key)
  }
  return result
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string' || !value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}
