import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownRenderer } from '@/components/markdown-renderer'

function render(content: string, preview = false): string {
  return renderToStaticMarkup(createElement(MarkdownRenderer, { content, preview }))
}

describe('MarkdownRenderer HTML boundary', () => {
  it('does not emit raw HTML elements, comments, or event handlers', () => {
    const output = render(
      'Before <script>alert(1)</script> <img src=x onerror="alert(2)"> <!-- hidden --> <div onclick="alert(3)">text</div> After',
    )

    expect(output).not.toMatch(/<script/i)
    expect(output).not.toMatch(/<img/i)
    expect(output).not.toContain('onerror')
    expect(output).not.toContain('onclick')
    expect(output).not.toContain('<!--')
  })

  it('does not emit unsafe link protocols', () => {
    const output = render('[click](javascript:alert(1))')

    expect(output).not.toContain('javascript:')
  })

  it('preserves supported Markdown formatting', () => {
    const output = render('## Heading\n\n**bold** and `code`')

    expect(output).toContain('<h2')
    expect(output).toContain('<strong')
    expect(output).toContain('<code')
  })

  it('keeps preview rendering bounded to the first 240 characters', () => {
    const output = render(`${'a'.repeat(300)}\n\nsecond paragraph`, true)

    expect(output).toContain(`${'a'.repeat(240)}...`)
    expect(output).not.toContain('second paragraph')
  })
})
