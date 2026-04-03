import { schemaType } from '@/lib/config-schema-utils'
import type { JsonSchema } from '@/lib/config-schema-utils'
import type { DiffEntry } from './gateway-config-types'

/** Convert snake_case / camelCase key to human-readable label */
export function humanize(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/^./, m => m.toUpperCase())
}

/** Return a sensible empty value for a schema type */
export function defaultValueFor(schema?: JsonSchema): unknown {
  if (!schema) return ''
  if (schema.default !== undefined) return schema.default
  const t = schemaType(schema)
  switch (t) {
    case 'object': return {}
    case 'array': return []
    case 'boolean': return false
    case 'number': case 'integer': return 0
    case 'string': return ''
    default: return ''
  }
}

/** Deep-set a value at a dotted path, returning a new object (immutable) */
export function deepSet(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  if (path.length === 0) return obj
  const [head, ...tail] = path
  const current = obj[head]
  if (tail.length === 0) return { ...obj, [head]: value }
  const child =
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {}
  return { ...obj, [head]: deepSet(child, tail, value) }
}

/** Read a value at a dotted path from a nested object */
export function deepGet(obj: unknown, path: string[]): unknown {
  let current = obj
  for (const key of path) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** Return true if a field key/schema matches the search query */
export function matchesSearch(key: string, schema: JsonSchema, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  if (key.toLowerCase().includes(q)) return true
  if (schema.title?.toLowerCase().includes(q)) return true
  if (schema.description?.toLowerCase().includes(q)) return true
  const schemaTags = (schema['x-tags'] ?? schema.tags ?? []) as string[]
  if (schemaTags.some(t => typeof t === 'string' && t.toLowerCase().includes(q))) return true
  if (schema.properties) {
    for (const [k, v] of Object.entries(schema.properties)) {
      if (matchesSearch(k, v, query)) return true
    }
  }
  return false
}

/** Recursively compute field-level diff between two config snapshots */
export function computeDiff(original: unknown, current: unknown, path = ''): DiffEntry[] {
  if (original === current) return []
  if (typeof original !== typeof current) return [{ path, from: original, to: current }]
  if (typeof original !== 'object' || original === null || current === null) {
    return original !== current ? [{ path, from: original, to: current }] : []
  }
  if (Array.isArray(original) && Array.isArray(current)) {
    if (JSON.stringify(original) !== JSON.stringify(current)) {
      return [{ path, from: original, to: current }]
    }
    return []
  }
  const origObj = original as Record<string, unknown>
  const currObj = current as Record<string, unknown>
  const allKeys = new Set([...Object.keys(origObj), ...Object.keys(currObj)])
  const diffs: DiffEntry[] = []
  for (const key of allKeys) {
    diffs.push(...computeDiff(origObj[key], currObj[key], path ? `${path}.${key}` : key))
  }
  return diffs
}

/** Truncate any value to a short display string for the diff summary */
export function truncateValue(value: unknown, maxLen = 30): string {
  try {
    const str = JSON.stringify(value) ?? String(value)
    return str.length <= maxLen ? str : str.slice(0, maxLen - 3) + '...'
  } catch {
    return String(value)
  }
}
