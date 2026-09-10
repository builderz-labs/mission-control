import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ChatProjectFolder } from './chat-project-folder'
import type { SidebarRow } from '@/lib/group-sessions'
import en from '../../../../messages/en.json'

function wrap(ui: React.ReactElement) {
  return <NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>
}

const row: SidebarRow = {
  key: 'folder:stillpoint-builders',
  label: 'stillpoint-builders',
  sessionCount: 2,
  latestActivity: 50,
  hasPr: false,
  hasActive: true,
}

const folderProps = {
  'data-folder-key': row.key,
  draggable: false,
  onDragStart: vi.fn(),
  onDragOver: vi.fn(),
  onDrop: vi.fn(),
  onDragEnd: vi.fn(),
}

describe('ChatProjectFolder', () => {
  it('shows a live indicator on the project and each nested chat', () => {
    render(wrap(
      <ChatProjectFolder
        row={row}
        selected
        showPr={false}
        sessions={[
          { id: 'session:claude-code:1', kind: 'claude-code', title: 'Live chat', updatedAt: 50, active: true },
          { id: 'session:kimi:2', kind: 'kimi', title: 'Idle chat', updatedAt: 10, active: false },
        ]}
        activeSessionId="session:claude-code:1"
        pinned={false}
        dragging={false}
        onSelect={() => undefined}
        onNewInGroup={() => undefined}
        onTogglePin={() => undefined}
        onSelectSession={() => undefined}
        folderProps={folderProps}
      />,
    ))
    expect(screen.getAllByRole('status', { name: 'Active' })).toHaveLength(2)
    expect(screen.getByRole('status', { name: 'Idle' })).toBeTruthy()
    expect(screen.getByText('Live chat')).toBeTruthy()
    expect(screen.getByText('Idle chat')).toBeTruthy()
  })

  it('keeps live project chats visible even when the folder is not selected', () => {
    render(wrap(
      <ChatProjectFolder
        row={row}
        selected={false}
        showPr={false}
        sessions={[
          { id: 'session:claude-code:1', kind: 'claude-code', title: 'Live chat', updatedAt: 50, active: true },
        ]}
        activeSessionId={null}
        pinned={false}
        dragging={false}
        onSelect={() => undefined}
        onNewInGroup={() => undefined}
        onTogglePin={() => undefined}
        onSelectSession={() => undefined}
        folderProps={folderProps}
      />,
    ))
    expect(screen.getByText('Live chat')).toBeTruthy()
    expect(screen.getAllByRole('status', { name: 'Active' })).toHaveLength(2)
  })

  it('hides idle chats until the folder is selected', () => {
    render(wrap(
      <ChatProjectFolder
        row={{ ...row, hasActive: false }}
        selected={false}
        showPr={false}
        sessions={[
          { id: 'session:kimi:2', kind: 'kimi', title: 'Idle chat', updatedAt: 10, active: false },
        ]}
        activeSessionId={null}
        pinned={false}
        dragging={false}
        onSelect={() => undefined}
        onNewInGroup={() => undefined}
        onTogglePin={() => undefined}
        onSelectSession={() => undefined}
        folderProps={folderProps}
      />,
    ))
    expect(screen.queryByText('Idle chat')).toBeNull()
    expect(screen.getByRole('status', { name: 'Idle' })).toBeTruthy()
  })

  it('expands and collapses the project dropdown from the chevron', () => {
    render(wrap(
      <ChatProjectFolder
        row={{ ...row, hasActive: false }}
        selected={false}
        showPr={false}
        sessions={[
          { id: 'session:kimi:2', kind: 'kimi', title: 'Idle chat', updatedAt: 10, active: false },
        ]}
        activeSessionId={null}
        pinned={false}
        dragging={false}
        onSelect={() => undefined}
        onNewInGroup={() => undefined}
        onTogglePin={() => undefined}
        onSelectSession={() => undefined}
        folderProps={folderProps}
      />,
    ))
    expect(screen.queryByText('Idle chat')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand stillpoint-builders' }))
    expect(screen.getByText('Idle chat')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse stillpoint-builders' }))
    expect(screen.queryByText('Idle chat')).toBeNull()
  })
})
