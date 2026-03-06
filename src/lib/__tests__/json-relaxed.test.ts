import { describe, expect, it } from 'vitest'
import { parseJsonRelaxed } from '@/lib/json-relaxed'

describe('parseJsonRelaxed', () => {
  it('parses strict JSON unchanged', () => {
    const parsed = parseJsonRelaxed<{ a: number; b: string }>('{"a":1,"b":"ok"}')
    expect(parsed).toEqual({ a: 1, b: 'ok' })
  })

  it('parses JSON with line comments and trailing commas', () => {
    const raw = `{
      // top-level comment
      "agents": {
        "list": [
          { "id": "a", "name": "A", },
        ],
      },
    }`

    const parsed = parseJsonRelaxed<any>(raw)
    expect(parsed.agents.list[0].id).toBe('a')
    expect(parsed.agents.list[0].name).toBe('A')
  })

  it('parses JSON with block comments', () => {
    const raw = `{
      /* comment */
      "gateway": { "port": 18789 }
    }`

    const parsed = parseJsonRelaxed<any>(raw)
    expect(parsed.gateway.port).toBe(18789)
  })

  it('does not strip URL fragments inside strings', () => {
    const raw = `{
      "url": "https://example.com/a//b",
      "ok": true,
    }`

    const parsed = parseJsonRelaxed<any>(raw)
    expect(parsed.url).toBe('https://example.com/a//b')
    expect(parsed.ok).toBe(true)
  })

  it('throws on invalid JSON after normalization', () => {
    expect(() => parseJsonRelaxed<any>('{ broken: true }')).toThrow()
  })
})
