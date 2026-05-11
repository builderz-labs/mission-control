import { describe, it, expect } from 'vitest'
import { loadExtensionMessages } from '../index'

const REQUIRED_NAMESPACES = ['oapApprovals', 'litellmUsage'] as const
const LOCALES = ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar'] as const

describe('loadExtensionMessages', () => {
  it.each(LOCALES)('loads %s with both extension namespaces', async (locale) => {
    const messages = await loadExtensionMessages(locale)
    for (const ns of REQUIRED_NAMESPACES) {
      expect(messages, `locale ${locale} missing ${ns}`).toHaveProperty(ns)
      expect(typeof messages[ns]).toBe('object')
      expect(Object.keys(messages[ns]).length).toBeGreaterThan(0)
    }
  })

  it('returns identical key shape across all locales (no drift)', async () => {
    const en = await loadExtensionMessages('en')
    for (const locale of LOCALES) {
      if (locale === 'en') continue
      const other = await loadExtensionMessages(locale)
      for (const ns of REQUIRED_NAMESPACES) {
        expect(
          Object.keys(other[ns]).sort(),
          `${locale}/${ns} key set drifts from en/${ns}`,
        ).toEqual(Object.keys(en[ns]).sort())
      }
    }
  })

  it('returns empty object for an unknown locale (graceful)', async () => {
    const messages = await loadExtensionMessages('xx-not-a-real-locale')
    expect(messages).toEqual({})
  })
})
