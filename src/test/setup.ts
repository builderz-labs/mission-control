import '@testing-library/jest-dom'

// Node 24 exposes an undefined localStorage unless a storage file is supplied.
// Keep browser-focused tests deterministic without depending on a host file.
if (!globalThis.localStorage) {
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(String(key), String(value)),
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
}
