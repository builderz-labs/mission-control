import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/store', async () => {
  const React = await import('react')
  const initialTree = [{ type: 'file', path: 'docs/plans/x.md', name: 'x.md', size: 10, modified: 0 }]
  return {
    useMissionControl: () => {
      const [memoryFiles, setMemoryFiles] = React.useState<unknown[]>(initialTree)
      const [selectedMemoryFile, setSelectedMemoryFile] = React.useState<string | null>(null)
      const [memoryContent, setMemoryContent] = React.useState<string | null>(null)
      const [memoryFileLinks, setMemoryFileLinks] = React.useState<unknown>(null)
      return {
        memoryFiles,
        selectedMemoryFile,
        memoryContent,
        memoryFileLinks,
        memoryHealth: null,
        dashboardMode: 'local',
        setMemoryFiles,
        setSelectedMemoryFile,
        setMemoryContent,
        setMemoryFileLinks,
        setMemoryHealth: vi.fn(),
      }
    },
  }
})

const apiFetchMock = vi.fn(async (url: string) => {
  if (url.includes('action=content')) {
    return { content: '# Plan\n\nHello world' }
  }
  if (url.includes('action=tree')) {
    return {
      tree: [{ type: 'file', path: 'docs/plans/x.md', name: 'x.md', size: 10, modified: 0 }],
    }
  }
  return {}
})

vi.mock('@/lib/api-client', () => ({
  apiFetch: (url: string) => apiFetchMock(url),
}))

vi.mock('@/components/panels/memory-graph', () => ({
  MemoryGraph: () => null,
}))

import { MemoryBrowserPanel } from './memory-browser-panel'

describe('MemoryBrowserPanel deep links', () => {
  beforeEach(() => {
    apiFetchMock.mockClear()
    window.history.replaceState({}, '', '/memory')
  })

  it('opens the file referenced by ?path= on mount', async () => {
    window.history.replaceState({}, '', '/memory?path=docs%2Fplans%2Fx.md')
    render(<MemoryBrowserPanel />)
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith('/api/memory?action=content&path=docs%2Fplans%2Fx.md')
    })
    expect(await screen.findByText(/Hello world/)).toBeInTheDocument()
  })

  it('does not load file content without ?path=', async () => {
    render(<MemoryBrowserPanel />)
    await screen.findByText('x.md')
    expect(apiFetchMock.mock.calls.some(([url]) => String(url).includes('action=content'))).toBe(false)
  })
})
