import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('chat second-rail contract', () => {
  it('puts a live indicator on every project folder and session row', () => {
    const folder = source('src/components/chat/desktop/chat-project-folder.tsx')
    const row = source('src/components/chat/desktop/chat-session-row.tsx')
    expect(folder).toContain('ChatLiveDot')
    expect(folder).toContain('selected || row.hasActive')
    expect(row).toContain('ChatLiveDot')
    expect(row).toContain('session.active')
  })

  it('sorts projects by activity and ignores folder order in that mode', () => {
    const groups = source('src/lib/group-sessions.ts')
    const list = source('src/components/chat/desktop/chat-project-list.tsx')
    expect(groups).toContain("if (sortBy === 'activity') return sorted")
    expect(list).toContain("filters.sortBy === 'activity' ? pinned")
  })

  it('glimmers the live stream while the agent is working', () => {
    const bar = source('src/components/chat/session/session-status-bar.tsx')
    const thread = source('src/components/chat/session/session-thread.tsx')
    const pane = source('src/components/chat/session/chat-session-pane.tsx')
    expect(bar).toContain('chat-glimmer-line')
    expect(thread).toContain('chat-glimmer-line')
    expect(pane).toContain('isAgentWorking')
    expect(pane).toContain('busy')
  })
})
