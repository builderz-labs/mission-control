import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultLocale, locales } from './config'

type Messages = { [key: string]: string | Messages }

function flattenKeys(node: Messages, prefix = ''): Set<string> {
  const keys = new Set<string>()
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'object' && value !== null) {
      for (const nested of flattenKeys(value as Messages, path)) keys.add(nested)
    } else {
      keys.add(path)
    }
  }
  return keys
}

function loadMessages(locale: string): Messages {
  const path = join(process.cwd(), 'messages', `${locale}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Messages
}

describe('locale message parity', () => {
  const reference = flattenKeys(loadMessages(defaultLocale))

  it(`the ${defaultLocale} reference catalog is non-trivial`, () => {
    expect(reference.size).toBeGreaterThan(1000)
  })

  for (const locale of locales) {
    if (locale === defaultLocale) continue

    it(`${locale}.json has exactly the ${defaultLocale}.json key set`, () => {
      const keys = flattenKeys(loadMessages(locale))
      const missing = [...reference].filter((key) => !keys.has(key)).sort()
      const extra = [...keys].filter((key) => !reference.has(key)).sort()
      expect(missing, `keys missing from ${locale}.json`).toEqual([])
      expect(extra, `keys present only in ${locale}.json`).toEqual([])
    })

    it(`${locale}.json has no empty translations`, () => {
      const empty: string[] = []
      const walk = (node: Messages, prefix = '') => {
        for (const [key, value] of Object.entries(node)) {
          const path = prefix ? `${prefix}.${key}` : key
          if (typeof value === 'object' && value !== null) walk(value as Messages, path)
          else if (typeof value === 'string' && value.trim() === '') empty.push(path)
        }
      }
      walk(loadMessages(locale))
      expect(empty, `empty translations in ${locale}.json`).toEqual([])
    })
  }
})
