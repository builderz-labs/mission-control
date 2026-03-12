import { describe, it, expect } from 'vitest'
import { detectProvider, generateCsvContent, applyTimezoneOffset } from '../token-utils'

describe('detectProvider', () => {
  it.each([
    ['claude-3-opus', 'Anthropic'],
    ['claude-sonnet-4', 'Anthropic'],
    ['gpt-4o', 'OpenAI'],
    ['gpt-3.5-turbo', 'OpenAI'],
    ['gemini-pro', 'Google'],
    ['mistral-large', 'Mistral'],
    ['llama-3', 'Meta'],
    ['deepseek-coder', 'DeepSeek'],
    ['venice/llama-3.3-70b', 'Venice AI'],
    ['unknown-model', 'Other'],
  ])('%s -> %s', (model, expected) => {
    expect(detectProvider(model)).toBe(expected)
  })
})

describe('generateCsvContent', () => {
  const columns = ['name', 'value', 'note']

  it('returns header row only for empty data', () => {
    const result = generateCsvContent([], columns)
    expect(result).toBe('name,value,note')
  })

  it('returns header + 1 data row for single entry', () => {
    const data = [{ name: 'foo', value: 42, note: 'ok' }]
    const result = generateCsvContent(data, columns)
    expect(result).toBe('name,value,note\nfoo,42,ok')
  })

  it('quotes values containing commas', () => {
    const data = [{ name: 'a,b', value: 1, note: 'fine' }]
    const result = generateCsvContent(data, columns)
    expect(result).toBe('name,value,note\n"a,b",1,fine')
  })

  it('escapes double quotes within values', () => {
    const data = [{ name: 'say "hello"', value: 1, note: 'x' }]
    const result = generateCsvContent(data, columns)
    expect(result).toBe('name,value,note\n"say ""hello""",1,x')
  })

  it('handles undefined/null values as empty strings', () => {
    const data = [{ name: 'test' }]
    const result = generateCsvContent(data, columns)
    expect(result).toBe('name,value,note\ntest,,')
  })
})

describe('applyTimezoneOffset', () => {
  const base = '2024-06-15T12:00:00.000Z'

  it('returns same time for offset 0', () => {
    const result = applyTimezoneOffset(base, 0)
    const d = new Date(result)
    expect(d.getUTCHours()).toBe(12)
  })

  it('shifts forward by 5 hours', () => {
    const result = applyTimezoneOffset(base, 5)
    const d = new Date(result)
    expect(d.getUTCHours()).toBe(17)
  })

  it('shifts backward by 8 hours', () => {
    const result = applyTimezoneOffset(base, -8)
    const d = new Date(result)
    expect(d.getUTCHours()).toBe(4)
  })
})
