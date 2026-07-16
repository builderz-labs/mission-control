import { describe, test, expect } from 'vitest'
import {
  extractWikiLinks,
  extractSchema,
  validateSchema,
} from '../memory-utils'

describe('extractWikiLinks', () => {
  test('extracts basic wiki-links', () => {
    const content = 'See [[my-note]] for details.'
    const links = extractWikiLinks(content)
    expect(links).toHaveLength(1)
    expect(links[0]).toEqual({ target: 'my-note', display: 'my-note', line: 1 })
  })

  test('extracts wiki-links with display text (alias)', () => {
    const content = 'Check [[my-note|My Custom Label]].'
    const links = extractWikiLinks(content)
    expect(links).toHaveLength(1)
    expect(links[0]).toEqual({ target: 'my-note', display: 'My Custom Label', line: 1 })
  })

  test('extracts multiple links on same line', () => {
    const content = '[[foo]] and [[bar]] are related.'
    const links = extractWikiLinks(content)
    expect(links).toHaveLength(2)
    expect(links[0].target).toBe('foo')
    expect(links[1].target).toBe('bar')
  })

  test('extracts links across multiple lines', () => {
    const content = 'Line 1 has [[alpha]]\nLine 2 is plain\nLine 3 has [[beta]]'
    const links = extractWikiLinks(content)
    expect(links).toHaveLength(2)
    expect(links[0]).toEqual({ target: 'alpha', display: 'alpha', line: 1 })
    expect(links[1]).toEqual({ target: 'beta', display: 'beta', line: 3 })
  })

  test('returns empty for no links', () => {
    expect(extractWikiLinks('No links here.')).toEqual([])
  })

  test('trims whitespace in targets', () => {
    const links = extractWikiLinks('See [[ spaced-note ]].')
    expect(links).toHaveLength(1)
    expect(links[0].target).toBe('spaced-note')
  })
})

describe('extractSchema', () => {
  test('returns null for no frontmatter', () => {
    expect(extractSchema('# Just a heading')).toBeNull()
  })

  test('returns null for frontmatter without _schema', () => {
    const content = '---\ntitle: My Note\n---\nBody text'
    expect(extractSchema(content)).toBeNull()
  })

  test('extracts type from _schema block', () => {
    const content = '---\n_schema:\n  type: note\n---\nBody'
    const schema = extractSchema(content)
    expect(schema).not.toBeNull()
    expect(schema!.type).toBe('note')
  })

  test('extracts required fields', () => {
    const content = '---\n_schema:\n  type: note\n  required: [title, tags]\n---\n'
    const schema = extractSchema(content)
    expect(schema!.required).toEqual(['title', 'tags'])
  })

  test('extracts optional fields', () => {
    const content = '---\n_schema:\n  type: note\n  optional: [source, author]\n---\n'
    const schema = extractSchema(content)
    expect(schema!.optional).toEqual(['source', 'author'])
  })

  test('does not backtrack on adversarial inline-list content', () => {
    const content = `---\n_schema:\n  type: note\n  required: [${'\\'.repeat(100_000)}\n---\n`
    const schema = extractSchema(content)
    expect(schema).toEqual({ type: 'note' })
  })
})

describe('validateSchema', () => {
  test('valid when no schema present', () => {
    const result = validateSchema('# No schema\nBody text')
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.schema).toBeNull()
  })

  test('valid when all required fields present', () => {
    const content = '---\ntitle: Hello\ntags: [a, b]\n_schema:\n  type: note\n  required: [title, tags]\n---\n'
    const result = validateSchema(content)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  test('invalid when required fields missing', () => {
    const content = '---\ntitle: Hello\n_schema:\n  type: note\n  required: [title, tags]\n---\n'
    const result = validateSchema(content)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required field: tags')
  })

  test('reports all missing fields', () => {
    const content = '---\n_schema:\n  type: note\n  required: [title, tags, source]\n---\n'
    const result = validateSchema(content)
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(3)
  })
})
