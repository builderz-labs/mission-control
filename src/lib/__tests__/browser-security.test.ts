import { describe, expect, it } from 'vitest'
import { isLocalDashboardHost, shouldRedirectDashboardToHttps } from '@/lib/browser-security'

describe('isLocalDashboardHost', () => {
  it('treats localhost variants as local', () => {
    expect(isLocalDashboardHost('localhost')).toBe(true)
    expect(isLocalDashboardHost('127.0.0.1')).toBe(true)
    expect(isLocalDashboardHost('test.local')).toBe(true)
  })
})

describe('shouldRedirectDashboardToHttps', () => {
  it('does not redirect remote HTTP dashboards unless explicitly forced', () => {
    expect(shouldRedirectDashboardToHttps({
      protocol: 'http:',
      hostname: '192.168.1.20',
      forceHttps: false,
    })).toBe(false)
  })

  it('redirects remote HTTP dashboards only when forceHttps is enabled', () => {
    expect(shouldRedirectDashboardToHttps({
      protocol: 'http:',
      hostname: 'example.tailnet.ts.net',
      forceHttps: true,
    })).toBe(true)
  })

  it('never redirects localhost', () => {
    expect(shouldRedirectDashboardToHttps({
      protocol: 'http:',
      hostname: 'localhost',
      forceHttps: true,
    })).toBe(false)
  })
})
