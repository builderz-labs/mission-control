interface ServerReadCacheEntry<T> {
  hasValue: boolean
  value?: T
  expiresAt: number
  inFlight: Promise<T> | null
}

export interface ServerReadCacheApi<T> {
  get: (key: string, ttlMs: number, loader: () => Promise<T>) => Promise<T>
  clear: (key?: string) => void
}

export function createServerReadCache<T>(): ServerReadCacheApi<T> {
  const entries = new Map<string, ServerReadCacheEntry<T>>()

  return {
    async get(key: string, ttlMs: number, loader: () => Promise<T>) {
      const now = Date.now()
      const existing = entries.get(key)

      if (existing?.hasValue && existing.expiresAt > now) {
        return existing.value as T
      }

      if (existing?.inFlight) {
        return existing.inFlight
      }

      const pending = loader()
        .then((value) => {
          entries.set(key, {
            hasValue: true,
            value,
            expiresAt: Date.now() + ttlMs,
            inFlight: null,
          })
          return value
        })
        .catch((error) => {
          if (existing?.hasValue) {
            entries.set(key, {
              hasValue: true,
              value: existing.value,
              expiresAt: Date.now() + Math.min(ttlMs, 1000),
              inFlight: null,
            })
            return existing.value as T
          }
          entries.delete(key)
          throw error
        })

      entries.set(key, {
        hasValue: existing?.hasValue ?? false,
        value: existing?.value,
        expiresAt: existing?.expiresAt ?? 0,
        inFlight: pending,
      })

      return pending
    },

    clear(key?: string) {
      if (key) {
        entries.delete(key)
        return
      }
      entries.clear()
    },
  }
}
