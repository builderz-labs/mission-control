import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopBrowserLogin } from './desktop-browser-login'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('DesktopBrowserLogin', () => {
  it('explains the passwordless path before creating a code', () => {
    render(<DesktopBrowserLogin onAuthenticated={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Sign in with the desktop app' })).toBeInTheDocument()
    expect(screen.getByText(/No browser password needed/)).toBeInTheDocument()
  })

  it('shows a one-time code and completes after desktop approval', async () => {
    vi.useFakeTimers()
    const onAuthenticated = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        request_id: 'request-id', code: 'ABCD-2345',
        expires_at: Math.floor(Date.now() / 1000) + 300,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'approved' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<DesktopBrowserLogin onAuthenticated={onAuthenticated} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with the desktop app' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('ABCD-2345')).toBeInTheDocument()
    expect(screen.getByText(/Settings → Browser access/)).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(onAuthenticated).toHaveBeenCalledOnce()
  })
})
