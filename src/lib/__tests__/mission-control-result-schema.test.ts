import { describe, expect, it } from 'vitest'

const {
  validateMissionControlResult,
} = require('../../../scripts/mission-control-result-schema.cjs')

function makeCanonicalResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 'PASS',
    risk_level: 0,
    summary: {},
    checks: [],
    failures: [],
    warnings: [],
    next_actions: [],
    validation: {
      steps: [
        { step: 'typecheck', status: 'PASS' },
      ],
    },
    metadata: {},
    ...overrides,
  }
}

describe('mission-control result schema', () => {
  it('passes a valid canonical result', () => {
    const result = validateMissionControlResult(makeCanonicalResult())

    expect(result.valid).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.normalized.status).toBe('PASS')
  })

  it('normalizes legacy OK to PASS', () => {
    const result = validateMissionControlResult(makeCanonicalResult({
      status: 'OK',
    }))

    expect(result.valid).toBe(true)
    expect(result.normalized.status).toBe('PASS')
  })

  it('warns when legacy OK is normalized to PASS', () => {
    const result = validateMissionControlResult(makeCanonicalResult({
      status: 'OK',
    }))

    expect(result.warnings).toContain('Legacy status OK normalized to PASS')
  })

  it('fails on unknown statuses', () => {
    const result = validateMissionControlResult(makeCanonicalResult({
      status: 'DONE',
    }))

    expect(result.valid).toBe(false)
    expect(result.failures).toContain('Unknown status value: DONE')
  })

  it('fails when a required field is missing', () => {
    const { metadata: _metadata, ...input } = makeCanonicalResult()

    const result = validateMissionControlResult(input)

    expect(result.valid).toBe(false)
    expect(result.failures).toContain('Missing required field: metadata')
  })

  it('fails when risk_level is invalid', () => {
    const result = validateMissionControlResult(makeCanonicalResult({
      risk_level: Number.NaN,
    }))

    expect(result.valid).toBe(false)
    expect(result.failures).toContain('risk_level must be a finite number >= 0')
  })

  it('fails when canonical array fields are invalid', () => {
    const result = validateMissionControlResult(makeCanonicalResult({
      checks: {},
    }))

    expect(result.valid).toBe(false)
    expect(result.failures).toContain('checks must be an array')
  })

  it('fails when a validation command status is invalid', () => {
    const result = validateMissionControlResult(makeCanonicalResult({
      validation: {
        steps: [
          { step: 'typecheck', status: 'MAYBE' },
        ],
      },
    }))

    expect(result.valid).toBe(false)
    expect(result.failures).toContain('Unknown validation status for typecheck: MAYBE')
  })

  it('warns on unknown extra fields when enabled', () => {
    const result = validateMissionControlResult(makeCanonicalResult({
      unexpected_field: true,
    }), {
      warnOnUnknownFields: true,
    })

    expect(result.valid).toBe(true)
    expect(result.warnings).toContain('Unknown field: unexpected_field')
  })
})
