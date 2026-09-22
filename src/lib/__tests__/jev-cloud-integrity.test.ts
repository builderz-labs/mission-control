// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hashJevCloudPayload } from '@/lib/jev-cloud-integrity'

describe('Jev cloud snapshot integrity', () => {
  it('hashes the exact canonical redacted JSON bytes', () => {
    const payload = { snapshot: { z: 2, a: '[redacted]' }, schema_version: 1 }
    const canonical = '{"schema_version":1,"snapshot":{"a":"[redacted]","z":2}}'
    expect(hashJevCloudPayload(payload)).toBe(createHash('sha256').update(canonical).digest('hex'))
  })

  it('ignores object key order but detects changed values and array ordering', () => {
    expect(hashJevCloudPayload({ z: { b: 2, a: 1 }, a: null }))
      .toBe(hashJevCloudPayload({ a: null, z: { a: 1, b: 2 } }))
    expect(hashJevCloudPayload({ a: 1 })).not.toBe(hashJevCloudPayload({ a: 2 }))
    expect(hashJevCloudPayload(['a', 'b'])).not.toBe(hashJevCloudPayload(['b', 'a']))
    expect(() => hashJevCloudPayload(undefined)).toThrow('PAYLOAD_INVALID')
  })
})
