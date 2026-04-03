/**
 * Tests for src/lib/types/sql.ts
 * Covers getErrorMessage and toError utility functions.
 */
import { describe, it, expect } from 'vitest'
import { getErrorMessage, toError } from '../types/sql'

describe('getErrorMessage', () => {
  it('returns message from Error instances', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('returns the string itself for string errors', () => {
    expect(getErrorMessage('something went wrong')).toBe('something went wrong')
  })

  it('stringifies non-Error, non-string values', () => {
    expect(getErrorMessage(42)).toBe('42')
    expect(getErrorMessage(null)).toBe('null')
    expect(getErrorMessage(undefined)).toBe('undefined')
    expect(getErrorMessage({ code: 500 })).toBe('[object Object]')
  })
})

describe('toError', () => {
  it('returns the same Error instance when given an Error', () => {
    const err = new Error('original')
    expect(toError(err)).toBe(err)
  })

  it('wraps a string in a new Error', () => {
    const result = toError('string error')
    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('string error')
  })

  it('wraps null in a new Error', () => {
    const result = toError(null)
    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('null')
  })

  it('wraps a number in a new Error', () => {
    const result = toError(404)
    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('404')
  })
})
