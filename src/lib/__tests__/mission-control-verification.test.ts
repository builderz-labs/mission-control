import { describe, expect, it } from 'vitest'

const {
  verifyCompletedRun,
} = require('../../../scripts/mission-control-verification.cjs')

describe('mission-control verification', () => {
  it('passes a valid completed run', () => {
    const result = verifyCompletedRun({
      status: 'PASS',
      risk_level: 0,
      summary: {},
      checks: [],
      failures: [],
      warnings: [],
      next_actions: [],
      metadata: {},
      git: { is_clean: true },
      validation: {
        steps: [
          { step: 'typecheck', status: 'PASS' },
          { step: 'test', status: 'PASS' },
          { step: 'build', status: 'PASS' },
        ],
      },
    }, {
      requiredValidationCommands: ['typecheck', 'test', 'build'],
    })

    expect(result.status).toBe('PASS')
    expect(result.failures).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('uses the normalized canonical result inside the verifier', () => {
    const result = verifyCompletedRun({
      status: 'OK',
      risk_level: 0,
      summary: {},
      checks: [],
      failures: [],
      warnings: [],
      next_actions: [],
      metadata: {},
      validation: {
        steps: [
          { step: 'typecheck', status: 'PASS' },
        ],
      },
    })

    expect(result.normalized.status).toBe('PASS')
  })

  it('warns when legacy OK is normalized inside the verifier', () => {
    const result = verifyCompletedRun({
      status: 'OK',
      risk_level: 0,
      summary: {},
      checks: [],
      failures: [],
      warnings: [],
      next_actions: [],
      metadata: {},
      validation: {
        steps: [],
      },
    })

    expect(result.status).toBe('WARN')
    expect(result.warnings).toContain('Legacy status OK normalized to PASS')
  })

  it('fails when a required validation command fails', () => {
    const result = verifyCompletedRun({
      status: 'PASS',
      risk_level: 0,
      summary: {},
      checks: [],
      failures: [],
      warnings: [],
      next_actions: [],
      metadata: {},
      validation: {
        steps: [
          { step: 'typecheck', status: 'PASS' },
          { step: 'test', status: 'FAIL' },
          { step: 'build', status: 'PASS' },
        ],
      },
    }, {
      requiredValidationCommands: ['typecheck', 'test', 'build'],
    })

    expect(result.status).toBe('FAIL')
    expect(result.failures).toContain('Validation command failed: test')
  })

  it('fails when a required schema field is missing', () => {
    const result = verifyCompletedRun({
      status: 'PASS',
    })

    expect(result.status).toBe('FAIL')
    expect(result.failures).toContain('Missing required field: risk_level')
  })

  it('fails on an unknown run status value', () => {
    const result = verifyCompletedRun({
      status: 'DONE',
      risk_level: 0,
      summary: {},
      checks: [],
      failures: [],
      warnings: [],
      next_actions: [],
      metadata: {},
      validation: {},
    })

    expect(result.status).toBe('FAIL')
    expect(result.failures).toContain('Unknown status value: DONE')
  })

  it('warns when git state is dirty unexpectedly', () => {
    const result = verifyCompletedRun({
      status: 'PASS',
      risk_level: 0,
      summary: {},
      checks: [],
      failures: [],
      warnings: [],
      next_actions: [],
      metadata: {},
      validation: {},
      git: { is_clean: false },
    })

    expect(result.status).toBe('WARN')
    expect(result.warnings).toContain('Working tree is dirty')
  })

  it('warns when a required validation command is explicitly not run', () => {
    const result = verifyCompletedRun({
      status: 'PASS',
      risk_level: 0,
      summary: {},
      checks: [],
      failures: [],
      warnings: [],
      next_actions: [],
      metadata: {},
      validation: {
        steps: [
          { step: 'typecheck', status: 'PASS' },
          { step: 'test', status: 'PASS' },
          { step: 'build', status: 'NOT_RUN' },
        ],
      },
    }, {
      requiredValidationCommands: ['typecheck', 'test', 'build'],
    })

    expect(result.status).toBe('WARN')
    expect(result.warnings).toContain('Validation command not run: build')
  })

  it('fails when schema validation fails', () => {
    const result = verifyCompletedRun({
      status: 'PASS',
      risk_level: 0,
      summary: {},
      checks: {},
      failures: [],
      warnings: [],
      next_actions: [],
      metadata: {},
      validation: {},
    })

    expect(result.status).toBe('FAIL')
    expect(result.failures).toContain('checks must be an array')
  })
})
