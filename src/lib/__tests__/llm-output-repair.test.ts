import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  extractTaggedContent,
  repairJsonSyntax,
  repairAndParse,
  parseTextResponse,
  OutputRepairError,
} from '@/lib/llm/output-repair'

describe('extractTaggedContent', () => {
  it('extracts from [CONTENT] tags', () => {
    const raw = 'Some preamble\n[CONTENT]{"key": "value"}[/CONTENT]\nSome epilogue'
    expect(extractTaggedContent(raw)).toBe('{"key": "value"}')
  })

  it('extracts from ```json blocks', () => {
    const raw = 'Here is the result:\n```json\n{"key": "value"}\n```\nDone.'
    expect(extractTaggedContent(raw)).toBe('{"key": "value"}')
  })

  it('extracts from generic ``` blocks', () => {
    const raw = 'Result:\n```\n{"key": "value"}\n```'
    expect(extractTaggedContent(raw)).toBe('{"key": "value"}')
  })

  it('extracts JSON object from plain text', () => {
    const raw = 'The answer is {"importance": 7} based on analysis.'
    expect(extractTaggedContent(raw)).toBe('{"importance": 7}')
  })

  it('extracts JSON array from plain text', () => {
    const raw = 'Results: [1, 2, 3] are the scores.'
    expect(extractTaggedContent(raw)).toBe('[1, 2, 3]')
  })

  it('returns trimmed original if no patterns match', () => {
    const raw = '  just plain text  '
    expect(extractTaggedContent(raw)).toBe('just plain text')
  })

  it('prefers [CONTENT] tags over other patterns', () => {
    const raw = '```json\n{"wrong": true}\n```\n[CONTENT]{"right": true}[/CONTENT]'
    expect(extractTaggedContent(raw)).toBe('{"right": true}')
  })
})

describe('repairJsonSyntax', () => {
  it('removes trailing commas before }', () => {
    expect(repairJsonSyntax('{"a": 1, "b": 2,}')).toBe('{"a": 1, "b": 2}')
  })

  it('removes trailing commas before ]', () => {
    expect(repairJsonSyntax('[1, 2, 3,]')).toBe('[1, 2, 3]')
  })

  it('replaces single quotes when no double quotes present', () => {
    const input = "{'key': 'value'}"
    const result = repairJsonSyntax(input)
    expect(result).toContain('"')
  })

  it('preserves valid JSON unchanged', () => {
    const valid = '{"key": "value", "num": 42}'
    const result = JSON.parse(repairJsonSyntax(valid))
    expect(result).toEqual({ key: 'value', num: 42 })
  })
})

describe('repairAndParse', () => {
  const testSchema = z.object({
    importance: z.number().min(0).max(9),
    reason: z.string(),
  })

  it('parses clean JSON', () => {
    const raw = '{"importance": 7, "reason": "significant event"}'
    const result = repairAndParse(raw, testSchema)
    expect(result).toEqual({ importance: 7, reason: 'significant event' })
  })

  it('repairs and parses JSON with trailing comma', () => {
    const raw = '{"importance": 5, "reason": "moderate",}'
    const result = repairAndParse(raw, testSchema)
    expect(result).toEqual({ importance: 5, reason: 'moderate' })
  })

  it('extracts from code blocks and parses', () => {
    const raw = 'Here is my rating:\n```json\n{"importance": 8, "reason": "critical"}\n```'
    const result = repairAndParse(raw, testSchema)
    expect(result).toEqual({ importance: 8, reason: 'critical' })
  })

  it('extracts from [CONTENT] tags and parses', () => {
    const raw = 'Analysis:\n[CONTENT]{"importance": 3, "reason": "routine"}[/CONTENT]'
    const result = repairAndParse(raw, testSchema)
    expect(result).toEqual({ importance: 3, reason: 'routine' })
  })

  it('throws OutputRepairError with stage=parse on invalid JSON', () => {
    const raw = 'not json at all, just text'
    expect(() => repairAndParse(raw, testSchema)).toThrow(OutputRepairError)
    try {
      repairAndParse(raw, testSchema)
    } catch (err) {
      expect(err).toBeInstanceOf(OutputRepairError)
      expect((err as OutputRepairError).stage).toBe('parse')
    }
  })

  it('throws OutputRepairError with stage=validate on schema mismatch', () => {
    const raw = '{"importance": 15, "reason": "too high"}'
    expect(() => repairAndParse(raw, testSchema)).toThrow(OutputRepairError)
    try {
      repairAndParse(raw, testSchema)
    } catch (err) {
      expect(err).toBeInstanceOf(OutputRepairError)
      expect((err as OutputRepairError).stage).toBe('validate')
    }
  })

  it('throws OutputRepairError with stage=validate on missing fields', () => {
    const raw = '{"importance": 5}'
    expect(() => repairAndParse(raw, testSchema)).toThrow(OutputRepairError)
    try {
      repairAndParse(raw, testSchema)
    } catch (err) {
      expect(err).toBeInstanceOf(OutputRepairError)
      expect((err as OutputRepairError).stage).toBe('validate')
      expect((err as OutputRepairError).rawOutput).toBe(raw)
    }
  })
})

describe('parseTextResponse', () => {
  it('validates a plain string against a string schema', () => {
    const schema = z.string().min(1)
    expect(parseTextResponse('hello world', schema)).toBe('hello world')
  })

  it('trims whitespace before validation', () => {
    const schema = z.string().min(1)
    expect(parseTextResponse('  hello  ', schema)).toBe('hello')
  })

  it('throws OutputRepairError on validation failure', () => {
    const schema = z.string().min(10)
    expect(() => parseTextResponse('hi', schema)).toThrow(OutputRepairError)
  })
})
