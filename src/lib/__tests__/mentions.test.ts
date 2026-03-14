import { describe, it, expect } from 'vitest'
import { parseMentions } from '../mentions'

describe('parseMentions', () => {
  it('returns empty array for empty input', () => {
    expect(parseMentions('')).toEqual([])
  })

  it('returns empty array for null/undefined-like input', () => {
    // @ts-expect-error testing non-string
    expect(parseMentions(null)).toEqual([])
    // @ts-expect-error testing non-string
    expect(parseMentions(undefined)).toEqual([])
  })

  it('extracts a single mention', () => {
    expect(parseMentions('hello @alice')).toEqual(['alice'])
  })

  it('extracts multiple mentions', () => {
    const result = parseMentions('hey @alice and @bob, please help')
    expect(result).toContain('alice')
    expect(result).toContain('bob')
    expect(result).toHaveLength(2)
  })

  it('deduplicates mentions', () => {
    const result = parseMentions('@alice again @alice')
    expect(result).toEqual(['alice'])
  })

  it('deduplication is case-insensitive', () => {
    const result = parseMentions('@Alice and @alice')
    expect(result).toHaveLength(1)
  })

  it('handles mention at start of string', () => {
    expect(parseMentions('@root please help')).toEqual(['root'])
  })

  it('handles mention with dots and hyphens', () => {
    expect(parseMentions('@john.doe')).toEqual(['john.doe'])
    expect(parseMentions('@my-agent')).toEqual(['my-agent'])
  })

  it('does not match email addresses (preceded by alphanumeric)', () => {
    // email@example.com — the @ is preceded by alphanumeric, should NOT match
    const result = parseMentions('send to user@example.com')
    expect(result).not.toContain('example.com')
  })

  it('handles text with no mentions', () => {
    expect(parseMentions('no mentions here')).toEqual([])
  })

  it('preserves original case of first occurrence', () => {
    const result = parseMentions('@Alice')
    expect(result[0]).toBe('Alice')
  })

  it('handles mixed content', () => {
    const result = parseMentions('Task for @alice: review @bob\'s PR')
    expect(result).toContain('alice')
    expect(result).toContain('bob')
  })
})
