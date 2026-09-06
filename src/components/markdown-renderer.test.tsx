import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownRenderer } from './markdown-renderer'

describe('MarkdownRenderer linkifyFilePaths', () => {
  it('turns backticked file paths into memory-browser links', () => {
    render(
      <MarkdownRenderer
        linkifyFilePaths
        content={'**Plan persisted:** `docs/superpowers/plans/2026-08-26-qr-code-support.md`'}
      />,
    )
    const link = screen.getByRole('link', { name: 'docs/superpowers/plans/2026-08-26-qr-code-support.md' })
    expect(link).toHaveAttribute(
      'href',
      '/memory?path=docs%2Fsuperpowers%2Fplans%2F2026-08-26-qr-code-support.md',
    )
    expect(link.querySelector('code')).not.toBeNull()
  })

  it('turns bare file paths into links without swallowing punctuation', () => {
    render(<MarkdownRenderer linkifyFilePaths content="See agents/scripts/agent-runner.py, then act." />)
    const link = screen.getByRole('link', { name: 'agents/scripts/agent-runner.py' })
    expect(link).toHaveAttribute('href', '/memory?path=agents%2Fscripts%2Fagent-runner.py')
  })

  it('leaves autolinked URLs alone', () => {
    render(<MarkdownRenderer linkifyFilePaths content="Open http://localhost:3100/tasks?taskId=18 please" />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'http://localhost:3100/tasks?taskId=18')
  })

  it('does not linkify paths inside fenced code blocks', () => {
    render(<MarkdownRenderer linkifyFilePaths content={'```sh\ncat docs/plans/x.md\n```'} />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('is off by default', () => {
    render(<MarkdownRenderer content={'`docs/plans/x.md`'} />)
    expect(screen.queryByRole('link')).toBeNull()
  })
})
