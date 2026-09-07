import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '@/lib/api-client'
import { FlySessionStatus } from './fly-session-status'

vi.mock('@/lib/api-client',()=>({apiFetch:vi.fn()}))
vi.mock('@/lib/use-smart-poll',async()=>{
  const {useEffect}=await import('react')
  return {useSmartPoll:(callback:()=>Promise<void>)=>useEffect(()=>{void callback()},[callback])}
})
afterEach(()=>vi.clearAllMocks())
describe('Fly session chat status',()=>{
  it('shows the actual logo, scoped live worker count, and non-invoice estimate',async()=>{
    vi.mocked(apiFetch).mockResolvedValue({transport:'polled',activity:{submissions:3,active_workers:2,queued:1,estimated_compute_usd:0.0123}})
    render(<FlySessionStatus sessionId="claude-session" />)
    await waitFor(()=>expect(screen.getByLabelText('Fly session metrics')).toBeInTheDocument())
    expect(screen.getByAltText('Fly.io')).toHaveAttribute('src','/fly-logo.svg')
    expect(screen.getByText('2 active Fly workers · 1 queued')).toBeInTheDocument()
    expect(screen.getByText('$0.0123 session compute estimate')).toBeInTheDocument()
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toContain('session_id=claude-session')
  })
  it('does not treat HTML as activation or zero-cost success',async()=>{
    vi.mocked(apiFetch).mockResolvedValue({raw:'<html>login</html>'})
    render(<FlySessionStatus sessionId="session" />)
    await waitFor(()=>expect(screen.getByText(/no activation confirmed/)).toBeInTheDocument())
    expect(screen.queryByLabelText('Fly session metrics')).not.toBeInTheDocument()
  })
})
