import { describe, expect, it } from 'vitest'
import { transformGatewayChannels } from '@/lib/channel-snapshot'

describe('channel snapshot property safety', () => {
  it('stores special channel names without mutating dictionary prototypes', () => {
    const snapshot = transformGatewayChannels(JSON.parse(`{
      "channels": {
        "__proto__": { "configured": true, "running": true },
        "constructor": { "configured": true, "running": false }
      },
      "channelAccounts": {
        "__proto__": [{ "accountId": "safe" }],
        "constructor": [{ "accountId": "also-safe" }]
      },
      "channelOrder": ["__proto__", "constructor"]
    }`))

    expect(Object.getPrototypeOf(snapshot.channels)).toBeNull()
    expect(Object.getPrototypeOf(snapshot.channelAccounts)).toBeNull()
    expect(Object.hasOwn(snapshot.channels, '__proto__')).toBe(true)
    expect(Object.hasOwn(snapshot.channels, 'constructor')).toBe(true)
    expect(snapshot.channels.__proto__.configured).toBe(true)
    expect(snapshot.channelAccounts['constructor'][0].accountId).toBe('also-safe')
  })

  it('ignores inherited channel and account properties', () => {
    const channels = Object.create({
      inherited: { configured: true, running: true },
    }) as Record<string, unknown>
    const channelAccounts = Object.create({
      inherited: [{ accountId: 'inherited' }],
    }) as Record<string, unknown>

    const snapshot = transformGatewayChannels({
      channels,
      channelAccounts,
      channelOrder: ['inherited'],
    })

    expect(snapshot.channelOrder).toEqual(['inherited'])
    expect(Object.hasOwn(snapshot.channels, 'inherited')).toBe(false)
    expect(Object.hasOwn(snapshot.channelAccounts, 'inherited')).toBe(false)
  })
})
