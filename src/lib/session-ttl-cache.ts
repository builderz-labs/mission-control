type Entry<T> = { at: number; value: T }

const store = new Map<string, Entry<unknown>>()

export function ttlGet<T>(key: string, ttlMs: number, load: () => T): T {
  const now = Date.now()
  const hit = store.get(key) as Entry<T> | undefined
  if (hit && now - hit.at < ttlMs) return hit.value
  const value = load()
  store.set(key, { at: now, value })
  return value
}

export function ttlClear(key?: string): void {
  if (key) store.delete(key)
  else store.clear()
}
