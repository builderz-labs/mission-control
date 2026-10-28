import { describe, expect, it } from 'vitest'
import { isFilePathToken, splitFilePathTokens, transformFileLinks } from '@/lib/remark-file-links'

describe('isFilePathToken', () => {
  it('accepts workspace-relative paths with an extension', () => {
    expect(isFilePathToken('docs/superpowers/plans/2026-08-26-qr-code-support.md')).toBe(true)
    expect(isFilePathToken('agents/scripts/agent-runner.py')).toBe(true)
    expect(isFilePathToken('src/lib/remark-file-links.ts')).toBe(true)
  })

  it('rejects bare filenames without a directory', () => {
    expect(isFilePathToken('README.md')).toBe(false)
    expect(isFilePathToken('config.ts')).toBe(false)
  })

  it('rejects paths without an extension', () => {
    expect(isFilePathToken('docs/superpowers/plans')).toBe(false)
    expect(isFilePathToken('github.com/foo')).toBe(false)
  })

  it('rejects URLs and absolute paths', () => {
    expect(isFilePathToken('https://example.com/a/b.md')).toBe(false)
    expect(isFilePathToken('http://localhost:3100/tasks?taskId=18')).toBe(false)
    expect(isFilePathToken('/etc/passwd.txt')).toBe(false)
  })

  it('rejects path traversal', () => {
    expect(isFilePathToken('../secrets/key.pem')).toBe(false)
    expect(isFilePathToken('a/../../b.md')).toBe(false)
  })

  it('rejects empty and malformed input', () => {
    expect(isFilePathToken('')).toBe(false)
    expect(isFilePathToken('   ')).toBe(false)
    expect(isFilePathToken('/')).toBe(false)
  })
})

describe('splitFilePathTokens', () => {
  it('splits text around a bare path', () => {
    expect(splitFilePathTokens('see docs/plans/x.md for details')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'path', value: 'docs/plans/x.md' },
      { type: 'text', value: ' for details' },
    ])
  })

  it('excludes trailing punctuation from the path', () => {
    expect(splitFilePathTokens('open docs/plans/x.md, then act')).toEqual([
      { type: 'text', value: 'open ' },
      { type: 'path', value: 'docs/plans/x.md' },
      { type: 'text', value: ', then act' },
    ])
    expect(splitFilePathTokens('(docs/plans/x.md).')).toEqual([
      { type: 'text', value: '(' },
      { type: 'path', value: 'docs/plans/x.md' },
      { type: 'text', value: ').' },
    ])
  })

  it('does not split URLs', () => {
    expect(splitFilePathTokens('go to http://localhost:3100/tasks?taskId=18 now')).toEqual([
      { type: 'text', value: 'go to http://localhost:3100/tasks?taskId=18 now' },
    ])
  })

  it('does not split when no path is present', () => {
    expect(splitFilePathTokens('nothing to see here')).toEqual([
      { type: 'text', value: 'nothing to see here' },
    ])
    expect(splitFilePathTokens('')).toEqual([{ type: 'text', value: '' }])
  })

  it('finds multiple paths in one string', () => {
    expect(splitFilePathTokens('copy a/b.ts to c/d.md')).toEqual([
      { type: 'text', value: 'copy ' },
      { type: 'path', value: 'a/b.ts' },
      { type: 'text', value: ' to ' },
      { type: 'path', value: 'c/d.md' },
    ])
  })
})

describe('transformFileLinks', () => {
  interface Node {
    type: string
    value?: string
    url?: string
    children?: Node[]
  }

  const run = (tree: Node) => {
    transformFileLinks(tree as never)
    return tree
  }

  const paragraph = (...children: Node[]): Node => ({ type: 'paragraph', children })

  it('links bare paths in text nodes to the memory browser', () => {
    const tree = run({
      type: 'root',
      children: [paragraph({ type: 'text', value: 'see docs/plans/x.md please' })],
    })
    const kids = tree.children![0].children!
    expect(kids[1]).toMatchObject({
      type: 'link',
      url: '/memory?path=docs%2Fplans%2Fx.md',
      children: [{ type: 'text', value: 'docs/plans/x.md' }],
    })
  })

  it('links inline code that is exactly a file path, preserving the code formatting', () => {
    const tree = run({
      type: 'root',
      children: [
        paragraph(
          { type: 'text', value: 'Plan persisted: ' },
          { type: 'inlineCode', value: 'docs/superpowers/plans/x.md' },
        ),
      ],
    })
    const kids = tree.children![0].children!
    expect(kids[1]).toMatchObject({
      type: 'link',
      url: '/memory?path=docs%2Fsuperpowers%2Fplans%2Fx.md',
      children: [{ type: 'inlineCode', value: 'docs/superpowers/plans/x.md' }],
    })
  })

  it('leaves non-path inline code untouched', () => {
    const tree = run({
      type: 'root',
      children: [paragraph({ type: 'inlineCode', value: 'pnpm test' })],
    })
    expect(tree.children![0].children![0].type).toBe('inlineCode')
  })

  it('does not touch fenced code blocks or existing links', () => {
    const tree = run({
      type: 'root',
      children: [
        { type: 'code', value: 'cat docs/plans/x.md' },
        paragraph({
          type: 'link',
          url: 'https://example.com',
          children: [{ type: 'text', value: 'docs/plans/x.md' }],
        }),
      ],
    })
    expect(tree.children![0].type).toBe('code')
    const link = tree.children![1].children![0]
    expect(link.type).toBe('link')
    expect(link.url).toBe('https://example.com')
    expect(link.children![0].type).toBe('text')
  })
})
