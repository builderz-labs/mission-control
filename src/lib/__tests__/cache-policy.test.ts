import { describe, expect, it } from 'vitest'
import { applyNoStoreDocumentHeaders } from '@/lib/cache-policy'

describe('applyNoStoreDocumentHeaders', () => {
  it('forces HTML pages to bypass browser caches', () => {
    const headers = applyNoStoreDocumentHeaders(new Headers())

    expect(headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate')
    expect(headers.get('Pragma')).toBe('no-cache')
    expect(headers.get('Expires')).toBe('0')
  })
})
