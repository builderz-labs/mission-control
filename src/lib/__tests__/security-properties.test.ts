import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { canonicalizeMemoryRelativePath } from '@/lib/memory-path'
import { resolveWithin } from '@/lib/paths'
import { setNestedConfigValue } from '@/lib/config-path'

const SAFE_BASE = '/srv/mission-control/memory'
const safeSegment = fc
  .stringMatching(/^[A-Za-z0-9_-]{1,20}$/)
  .filter((value) => !['__proto__', 'prototype', 'constructor'].includes(value))

describe('property-based security boundaries', () => {
  it('never resolves an accepted memory path outside its configured root', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 1100 }), (candidate) => {
        let canonical: string
        try {
          canonical = canonicalizeMemoryRelativePath(candidate)
        } catch {
          return
        }

        expect(canonical).not.toMatch(/^\/|^[A-Za-z]:/)
        expect(canonical.split('/')).not.toContain('')
        expect(canonical.split('/')).not.toContain('.')
        expect(canonical.split('/')).not.toContain('..')

        const resolved = resolveWithin(SAFE_BASE, canonical)
        expect(resolved.startsWith(`${SAFE_BASE}/`)).toBe(true)
      }),
      { numRuns: 1000 },
    )
  })

  it('round-trips generated canonical nested paths without widening scope', () => {
    fc.assert(
      fc.property(
        fc.array(safeSegment, { minLength: 1, maxLength: 8 }),
        (segments) => {
          const input = segments.join('/')
          expect(canonicalizeMemoryRelativePath(input)).toBe(input)
          expect(resolveWithin(SAFE_BASE, input).startsWith(`${SAFE_BASE}/`)).toBe(true)
        },
      ),
      { numRuns: 500 },
    )
  })

  it('rejects generated prototype-pollution paths without global mutation', () => {
    fc.assert(
      fc.property(
        fc.array(safeSegment, { maxLength: 3 }),
        fc.constantFrom('__proto__', 'prototype', 'constructor'),
        fc.array(safeSegment, { maxLength: 3 }),
        (prefix, unsafe, suffix) => {
          const target: Record<string, unknown> = {}
          const before = Object.getOwnPropertyNames(Object.prototype)
          const path = [...prefix, unsafe, ...suffix].join('.')

          expect(() => setNestedConfigValue(target, path, true)).toThrow(
            'Config path contains an unsafe segment',
          )
          expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(before)
        },
      ),
      { numRuns: 1000 },
    )
  })

  it('creates only own null-prototype intermediates for safe generated paths', () => {
    fc.assert(
      fc.property(
        fc.array(safeSegment, { minLength: 1, maxLength: 6 }),
        fc.jsonValue(),
        (segments, value) => {
          const target: Record<string, unknown> = {}
          setNestedConfigValue(target, segments.join('.'), value)

          let current = target
          for (const segment of segments.slice(0, -1)) {
            expect(Object.hasOwn(current, segment)).toBe(true)
            const next = current[segment] as Record<string, unknown>
            expect(Object.getPrototypeOf(next)).toBeNull()
            current = next
          }
          expect(current[segments.at(-1)!]).toEqual(value)
        },
      ),
      { numRuns: 500 },
    )
  })
})
