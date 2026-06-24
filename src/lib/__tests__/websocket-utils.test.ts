import { describe, it, expect } from 'vitest'
import {
  ConnectErrorDetailCodes,
  readErrorDetailCode,
  isNonRetryableErrorCode,
  calculateBackoff,
  detectSequenceGap,
  NON_RETRYABLE_ERROR_CODES,
  shouldRetryWithoutDeviceIdentity,
  buildProtocolNegotiation,
  GATEWAY_PROTOCOL_MIN,
  GATEWAY_PROTOCOL_MAX,
  GATEWAY_CLIENT_ID_UI,
  GATEWAY_CLIENT_ID_BACKEND,
  SUPPORTED_PROTOCOL,
  protocolRangeSatisfies,
} from '../websocket-utils'

describe('gateway protocol negotiation (issue #701)', () => {
  it('advertises a range, not a single pinned version', () => {
    expect(SUPPORTED_PROTOCOL.min).toBeLessThan(SUPPORTED_PROTOCOL.max)
  })

  it('buildProtocolNegotiation returns the min/max window', () => {
    expect(buildProtocolNegotiation()).toEqual({
      minProtocol: SUPPORTED_PROTOCOL.min,
      maxProtocol: SUPPORTED_PROTOCOL.max,
    })
  })

  it('still supports legacy v3 gateways', () => {
    expect(protocolRangeSatisfies(3)).toBe(true)
  })

  it('supports v4 gateways (OpenClaw 2026.5.18+)', () => {
    expect(protocolRangeSatisfies(4)).toBe(true)
  })

  it('does not satisfy a gateway requiring a version outside the window', () => {
    expect(protocolRangeSatisfies(2)).toBe(false)
    expect(protocolRangeSatisfies(5)).toBe(false)
  })
})

describe('readErrorDetailCode', () => {
  it('returns null for null/undefined input', () => {
    expect(readErrorDetailCode(null)).toBeNull()
    expect(readErrorDetailCode(undefined)).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(readErrorDetailCode('string' as any)).toBeNull()
    expect(readErrorDetailCode(42 as any)).toBeNull()
  })

  it('returns null when no code fields are present', () => {
    expect(readErrorDetailCode({ message: 'something failed' })).toBeNull()
  })

  it('extracts code from error.details.code (preferred)', () => {
    expect(
      readErrorDetailCode({ details: { code: 'AUTH_TOKEN_MISSING' } }),
    ).toBe('AUTH_TOKEN_MISSING')
  })

  it('falls back to error.code when details.code is absent', () => {
    expect(readErrorDetailCode({ code: 'ORIGIN_NOT_ALLOWED' })).toBe(
      'ORIGIN_NOT_ALLOWED',
    )
  })

  it('prefers details.code over top-level code', () => {
    expect(
      readErrorDetailCode({
        code: 'TOP_LEVEL',
        details: { code: 'DETAILS_CODE' },
      }),
    ).toBe('DETAILS_CODE')
  })

  it('ignores empty string codes', () => {
    expect(readErrorDetailCode({ code: '' })).toBeNull()
    expect(readErrorDetailCode({ details: { code: '' } })).toBeNull()
  })
})

describe('isNonRetryableErrorCode', () => {
  it('returns true for all non-retryable codes', () => {
    const nonRetryable = [
      'AUTH_TOKEN_MISSING',
      'AUTH_PASSWORD_MISSING',
      'AUTH_PASSWORD_MISMATCH',
      'AUTH_RATE_LIMITED',
      'ORIGIN_NOT_ALLOWED',
      'DEVICE_SIGNATURE_INVALID',
    ]
    for (const code of nonRetryable) {
      expect(isNonRetryableErrorCode(code)).toBe(true)
    }
  })

  it('returns false for AUTH_TOKEN_MISMATCH (retryable)', () => {
    expect(isNonRetryableErrorCode('AUTH_TOKEN_MISMATCH')).toBe(false)
  })

  it('returns false for unknown codes', () => {
    expect(isNonRetryableErrorCode('UNKNOWN_ERROR')).toBe(false)
    expect(isNonRetryableErrorCode('')).toBe(false)
  })
})

describe('calculateBackoff', () => {
  it('returns 1000ms for attempt 0', () => {
    expect(calculateBackoff(0)).toBe(1000)
  })

  it('returns 1700ms for attempt 1', () => {
    expect(calculateBackoff(1)).toBeCloseTo(1700, 0)
  })

  it('grows exponentially for attempt 5', () => {
    const result = calculateBackoff(5)
    // 1000 * 1.7^5 = 1000 * 14.19857 = ~14198.57
    expect(result).toBeCloseTo(14198.57, 0)
    expect(result).toBeLessThan(15000)
  })

  it('caps at 15000ms for high attempts', () => {
    expect(calculateBackoff(10)).toBe(15000)
    expect(calculateBackoff(20)).toBe(15000)
    expect(calculateBackoff(100)).toBe(15000)
  })
})

describe('shouldRetryWithoutDeviceIdentity', () => {
  it('retries once for DEVICE_SIGNATURE_INVALID when an auth token exists', () => {
    expect(
      shouldRetryWithoutDeviceIdentity(
        'Gateway rejected device signature',
        { details: { code: 'DEVICE_SIGNATURE_INVALID' } },
        true,
        false,
      ),
    ).toBe(true)
  })

  it('retries once for legacy device-signature messages', () => {
    expect(
      shouldRetryWithoutDeviceIdentity(
        'device_auth_signature_invalid',
        undefined,
        true,
        false,
      ),
    ).toBe(true)
  })

  it('does not retry without an auth token', () => {
    expect(
      shouldRetryWithoutDeviceIdentity(
        'device_auth_signature_invalid',
        undefined,
        false,
        false,
      ),
    ).toBe(false)
  })

  it('does not retry more than once', () => {
    expect(
      shouldRetryWithoutDeviceIdentity(
        'device_auth_signature_invalid',
        undefined,
        true,
        true,
      ),
    ).toBe(false)
  })

  it('does not retry for unrelated gateway errors', () => {
    expect(
      shouldRetryWithoutDeviceIdentity(
        'origin not allowed',
        { details: { code: 'ORIGIN_NOT_ALLOWED' } },
        true,
        false,
      ),
    ).toBe(false)
  })
})

describe('detectSequenceGap', () => {
  it('returns null when lastSeq is null (first message)', () => {
    expect(detectSequenceGap(null, 1)).toBeNull()
    expect(detectSequenceGap(null, 100)).toBeNull()
  })

  it('returns null for consecutive sequences (no gap)', () => {
    expect(detectSequenceGap(5, 6)).toBeNull()
    expect(detectSequenceGap(0, 1)).toBeNull()
  })

  it('returns null when currentSeq equals lastSeq + 1', () => {
    expect(detectSequenceGap(99, 100)).toBeNull()
  })

  it('returns null for duplicate or out-of-order sequences', () => {
    expect(detectSequenceGap(5, 5)).toBeNull()
    expect(detectSequenceGap(5, 3)).toBeNull()
  })

  it('detects a gap of 2 missed events', () => {
    const result = detectSequenceGap(5, 8)
    expect(result).toEqual({ from: 6, to: 7, count: 2 })
  })

  it('detects a gap of 1 missed event', () => {
    const result = detectSequenceGap(5, 7)
    expect(result).toEqual({ from: 6, to: 6, count: 1 })
  })

  it('detects a large gap', () => {
    const result = detectSequenceGap(10, 110)
    expect(result).toEqual({ from: 11, to: 109, count: 99 })
  })
})

describe('ConnectErrorDetailCodes', () => {
  it('has all expected keys', () => {
    const expectedKeys = [
      'AUTH_TOKEN_MISSING',
      'AUTH_PASSWORD_MISSING',
      'AUTH_PASSWORD_MISMATCH',
      'AUTH_RATE_LIMITED',
      'AUTH_TOKEN_MISMATCH',
      'ORIGIN_NOT_ALLOWED',
      'DEVICE_SIGNATURE_INVALID',
    ]
    for (const key of expectedKeys) {
      expect(ConnectErrorDetailCodes).toHaveProperty(key)
      expect((ConnectErrorDetailCodes as any)[key]).toBe(key)
    }
  })

  it('NON_RETRYABLE_ERROR_CODES does not include AUTH_TOKEN_MISMATCH', () => {
    expect(NON_RETRYABLE_ERROR_CODES.has('AUTH_TOKEN_MISMATCH')).toBe(false)
  })
})

describe('buildProtocolNegotiation', () => {
  it('advertises a range, not a pinned version (fixes the v3-only code=1002 mismatch)', () => {
    const neg = buildProtocolNegotiation()
    expect(neg.minProtocol).toBe(GATEWAY_PROTOCOL_MIN)
    expect(neg.maxProtocol).toBe(GATEWAY_PROTOCOL_MAX)
    expect(neg.maxProtocol).toBeGreaterThan(neg.minProtocol)
  })

  it('includes protocol 4 (required by 2026.6.x gateways) within the advertised range', () => {
    const neg = buildProtocolNegotiation()
    expect(neg.minProtocol).toBeLessThanOrEqual(4)
    expect(neg.maxProtocol).toBeGreaterThanOrEqual(4)
  })
})

describe('gateway client ids', () => {
  it('uses the allow-listed ids verified against the 2026.6.9 gateway', () => {
    expect(GATEWAY_CLIENT_ID_UI).toBe('openclaw-control-ui')
    expect(GATEWAY_CLIENT_ID_BACKEND).toBe('gateway-client')
  })
})
