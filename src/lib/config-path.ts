const UNSAFE_CONFIG_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function setNestedConfigValue(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = path.split('.')
  if (
    segments.length === 0
    || segments.some((segment) => segment.length === 0 || UNSAFE_CONFIG_SEGMENTS.has(segment))
  ) {
    throw new Error('Config path contains an unsafe segment')
  }

  let current = target
  for (const segment of segments.slice(0, -1)) {
    if (!Object.hasOwn(current, segment)) {
      current[segment] = Object.create(null) as Record<string, unknown>
    }

    const next = current[segment]
    if (!isRecord(next)) {
      throw new Error(`Cannot traverse non-object config value at: ${segment}`)
    }
    current = next
  }

  current[segments.at(-1)!] = value
}
