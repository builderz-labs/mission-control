import net from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  isAllowedAutoLoginNavigation,
  isAutoLoginEnabled,
  isLoopbackHostHeader,
  portFromUrl,
  safeAutoLoginTarget,
} from '@/lib/auto-login'
import { findExposedAddresses, nonLoopbackAddresses } from '@/lib/auto-login-probe'

let listener: net.Server
let listeningPort = 0

beforeAll(async () => {
  listener = net.createServer((socket) => socket.end())
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
  listeningPort = (listener.address() as net.AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => listener.close(() => resolve()))
})

describe('isAutoLoginEnabled', () => {
  const original = process.env.MC_AUTO_LOGIN

  afterEach(() => {
    if (original === undefined) delete process.env.MC_AUTO_LOGIN
    else process.env.MC_AUTO_LOGIN = original
  })

  it('turns on only for explicit truthy values', () => {
    for (const value of ['1', 'true', 'YES', 'on']) {
      process.env.MC_AUTO_LOGIN = value
      expect(isAutoLoginEnabled()).toBe(true)
    }
  })

  it('stays off when unset, malformed, or falsey', () => {
    delete process.env.MC_AUTO_LOGIN
    expect(isAutoLoginEnabled()).toBe(false)
    for (const value of ['', '0', 'false', 'maybe', 'auto']) {
      process.env.MC_AUTO_LOGIN = value
      expect(isAutoLoginEnabled()).toBe(false)
    }
  })

  it('ignores a value set by another user in the same process', () => {
    expect(isAutoLoginEnabled({ MC_AUTO_LOGIN: '1' })).toBe(true)
    expect(isAutoLoginEnabled({})).toBe(false)
  })
})

describe('isLoopbackHostHeader', () => {
  it('accepts loopback forms with and without a port', () => {
    for (const host of ['127.0.0.1', '127.0.0.1:3000', 'localhost', 'LOCALHOST:3000', '[::1]:3000', '::1']) {
      expect(isLoopbackHostHeader(host)).toBe(true)
    }
  })

  it('rejects anything that could reach another machine', () => {
    for (const host of ['192.168.1.20:3000', '10.0.0.5', 'evil.example.com', 'mc.local', '[fe80::1]:3000', '', null, undefined]) {
      expect(isLoopbackHostHeader(host)).toBe(false)
    }
  })

  it('rejects a host that merely starts with the loopback prefix', () => {
    expect(isLoopbackHostHeader('127.0.0.1.evil.com')).toBe(false)
    expect(isLoopbackHostHeader('12700001')).toBe(false)
    expect(isLoopbackHostHeader('127.0.0.999')).toBe(false)
    expect(isLoopbackHostHeader('127.0.0.1.2:3000')).toBe(false)
  })
})

describe('isAllowedAutoLoginNavigation', () => {
  it('accepts only direct and same-origin top-level navigation', () => {
    expect(isAllowedAutoLoginNavigation('none')).toBe(true)
    expect(isAllowedAutoLoginNavigation('SAME-ORIGIN')).toBe(true)
  })

  it('fails closed for cross-site, same-site, missing, and malformed values', () => {
    for (const value of ['cross-site', 'same-site', '', null, undefined]) {
      expect(isAllowedAutoLoginNavigation(value)).toBe(false)
    }
  })
})

describe('portFromUrl', () => {
  it('reads explicit and default ports', () => {
    expect(portFromUrl('http://127.0.0.1:3000/api/auth/auto-login')).toBe(3000)
    expect(portFromUrl('http://127.0.0.1/api/auth/auto-login')).toBe(80)
    expect(portFromUrl('https://127.0.0.1/api/auth/auto-login')).toBe(443)
  })

  it('returns null for a unusable url or port', () => {
    expect(portFromUrl('not-a-url')).toBeNull()
    expect(portFromUrl('http://127.0.0.1:0/')).toBeNull()
    expect(portFromUrl('http://127.0.0.1:99999/')).toBeNull()
  })
})

describe('safeAutoLoginTarget', () => {
  it('keeps same-origin absolute paths', () => {
    expect(safeAutoLoginTarget('/chat')).toBe('/chat')
    expect(safeAutoLoginTarget('/settings?tab=general')).toBe('/settings?tab=general')
  })

  it('falls back to the dashboard for anything that leaves this origin', () => {
    for (const raw of [null, undefined, '', '/', 'chat', 'http://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)']) {
      expect(safeAutoLoginTarget(raw)).toBe('/')
    }
  })
})

describe('auto-login reachability probe', () => {
  it('reports an address that accepts a connection on the app port', () => {
    // The mechanism being proven: a listening port on a candidate address is
    // treated as exposure. A real 0.0.0.0 bind produces exactly this shape.
    return expect(findExposedAddresses(listeningPort, { addresses: ['127.0.0.1'] })).resolves.toEqual(['127.0.0.1'])
  })

  it('reports nothing when no candidate answers', async () => {
    const unused = await findExposedAddresses(1, { addresses: ['127.0.0.1'] })
    expect(unused).toEqual([])
  })

  it('does not flag a loopback-only bind as exposed', async () => {
    const candidates = nonLoopbackAddresses()
    expect(candidates.every((address) => !address.startsWith('127.') && address !== '::1' && !address.startsWith('fe80'))).toBe(true)
    expect(await findExposedAddresses(listeningPort)).toEqual([])
  })

  // A throwaway listener, opened only to prove the probe would notice a wider
  // bind. Without this the loopback-only result above could just as well mean
  // "the probe cannot see anything at all".
  const hasRoutableInterface = nonLoopbackAddresses().length > 0
  it.skipIf(!hasRoutableInterface)('flags a port bound to all interfaces', async () => {
    const wideListener = net.createServer((socket) => socket.end())
    await new Promise<void>((resolve) => wideListener.listen(0, '0.0.0.0', resolve))
    try {
      const widePort = (wideListener.address() as net.AddressInfo).port
      const exposed = await findExposedAddresses(widePort)
      expect(exposed.length).toBeGreaterThan(0)
      expect(exposed).toContain(nonLoopbackAddresses()[0])
    } finally {
      await new Promise<void>((resolve) => wideListener.close(() => resolve()))
    }
  })
})
