import { describe, expect, it } from 'vitest'
import { setNestedConfigValue } from '@/lib/config-path'

describe('nested gateway config assignment security', () => {
  it.each([
    '__proto__.polluted',
    'constructor.prototype.polluted',
    'gateway.__proto__.polluted',
    'gateway..polluted',
  ])('rejects unsafe path %s', (path) => {
    const target: Record<string, unknown> = { gateway: {} }

    expect(() => setNestedConfigValue(target, path, true)).toThrow(
      'Config path contains an unsafe segment',
    )
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('does not traverse inherited properties', () => {
    const inherited = { nested: {} }
    const target = Object.create({ inherited }) as Record<string, unknown>

    setNestedConfigValue(target, 'inherited.value', true)

    expect(Object.hasOwn(target, 'inherited')).toBe(true)
    expect(inherited).toEqual({ nested: {} })
  })

  it('creates null-prototype intermediate records', () => {
    const target: Record<string, unknown> = {}

    setNestedConfigValue(target, 'gateway.channels.enabled', true)

    const gateway = target.gateway as Record<string, unknown>
    const channels = gateway.channels as Record<string, unknown>
    expect(Object.getPrototypeOf(gateway)).toBeNull()
    expect(Object.getPrototypeOf(channels)).toBeNull()
    expect(channels.enabled).toBe(true)
  })

  it('rejects traversal through arrays and scalar values', () => {
    expect(() => setNestedConfigValue({ gateway: [] }, 'gateway.value', true)).toThrow(
      'Cannot traverse non-object config value at: gateway',
    )
    expect(() => setNestedConfigValue({ gateway: 'local' }, 'gateway.value', true)).toThrow(
      'Cannot traverse non-object config value at: gateway',
    )
  })
})
