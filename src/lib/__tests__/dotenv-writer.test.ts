import { describe, expect, it } from 'vitest'
import { isSafeEnvValue, quoteHermesEnvValue, upsertHermesEnvContent } from '@/lib/dotenv-writer'

describe('dotenv writer', () => {
  it.each(['a\nb', 'a\rb', 'a\u0000b'])('flags unsafe value %j', (value) => {
    expect(isSafeEnvValue(value)).toBe(false)
    expect(() => upsertHermesEnvContent('', 'OPENAI_API_KEY', value)).toThrow(/line breaks or NUL/)
  })

  it('quotes like Hermes _quote_env_value', () => {
    expect(quoteHermesEnvValue('sk-abc_123')).toBe('sk-abc_123')
    expect(quoteHermesEnvValue('a#b')).toBe('"a#b"')
    expect(quoteHermesEnvValue(' padded')).toBe('" padded"')
    expect(quoteHermesEnvValue('a\tb')).toBe('"a\tb"')
    expect(quoteHermesEnvValue('say "hi" \\ ok')).toBe('"say \\"hi\\" \\\\ ok"')
    expect(quoteHermesEnvValue("it's")).toBe('"it\'s"')
  })

  it('replaces plain and export-prefixed lines and drops later duplicates', () => {
    const input = '# keep\nexport OPENAI_API_KEY=old\nOTHER=1\nOPENAI_API_KEY=older\n'
    expect(upsertHermesEnvContent(input, 'OPENAI_API_KEY', 'new')).toBe('# keep\nOPENAI_API_KEY=new\nOTHER=1\n')
  })

  it('does not match keys that only share a prefix', () => {
    expect(upsertHermesEnvContent('OPENAI_API_KEY_OLD=x\n', 'OPENAI_API_KEY', 'v'))
      .toBe('OPENAI_API_KEY_OLD=x\nOPENAI_API_KEY=v\n')
  })

  it('appends to a file without a trailing newline', () => {
    expect(upsertHermesEnvContent('A=1', 'OPENAI_API_KEY', 'v')).toBe('A=1\nOPENAI_API_KEY=v\n')
  })
})

describe('quoteHermesEnvValue python-only whitespace', () => {
  it('quotes values carrying characters Python strips but JS \\s ignores', () => {
    for (const ch of ['\x1c', '\x1f', '\x85']) {
      expect(quoteHermesEnvValue(`abc${ch}`)).toBe(`"abc${ch}"`)
    }
  })
})
