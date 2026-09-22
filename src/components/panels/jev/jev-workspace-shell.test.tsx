import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { JevWorkspaceShell } from './jev-workspace-shell'

describe('Jev mobile navigation', () => {
  it('runs the selected action before closing its drawer', () => {
    const onProject = vi.fn()
    render(<JevWorkspaceShell header="Workspace" sidebar={<button onClick={onProject}>Test project</button>}><p>Content</p></JevWorkspaceShell>)
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    const drawer = screen.getByRole('dialog', { name: 'Jev navigation' })
    const project = within(drawer).getByRole('button', { name: 'Test project' })
    fireEvent.click(project)
    expect(onProject).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse' })).toHaveAttribute('aria-expanded', 'false')
  })
})
