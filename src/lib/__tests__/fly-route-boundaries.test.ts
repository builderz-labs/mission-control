// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), deny: vi.fn(), db: vi.fn(), submit: vi.fn(), limiter: vi.fn() }))
vi.mock('@/lib/auth',()=>({requireRole:mocks.auth}))
vi.mock('@/lib/workspace-isolation',()=>({denyUnscopedResourceForStrictWorkspace:mocks.deny}))
vi.mock('@/lib/db',()=>({getDatabase:mocks.db}))
vi.mock('@/lib/fly-admission',()=>({submitFlyLeaf:mocks.submit}))
vi.mock('@/lib/rate-limit',()=>({createKeyedRateLimiter:()=>mocks.limiter}))
import { POST } from '@/app/api/fly/submit/route'

const payload = {title:'Check',description:'Smoke only',repository:'https://github.com/example/repo.git',base_sha:'a'.repeat(40)}
const request = (body: string) => new NextRequest('http://localhost/api/fly/submit',{method:'POST',body})
beforeEach(()=>{
  vi.clearAllMocks()
  mocks.auth.mockReturnValue({user:{id:1,username:'operator',workspace_id:7}})
  mocks.deny.mockReturnValue(null);mocks.limiter.mockReturnValue(null)
  mocks.db.mockReturnValue({})
  mocks.submit.mockReturnValue({accepted:true,route:'fly',safe_local_fallback:false})
})
describe('Fly HTTP admission boundary',()=>{
  it('requires operator access before reading the body or database',async()=>{
    mocks.auth.mockReturnValue({error:'Forbidden',status:403})
    expect((await POST(request(JSON.stringify(payload)))).status).toBe(403)
    expect(mocks.auth).toHaveBeenCalledWith(expect.anything(),'operator')
    expect(mocks.db).not.toHaveBeenCalled()
  })
  it('honors strict workspace denial and per-workspace rate limiting',async()=>{
    mocks.deny.mockReturnValue(new Response('{}',{status:403}))
    expect((await POST(request('{}'))).status).toBe(403)
    mocks.deny.mockReturnValue(null)
    mocks.limiter.mockReturnValue(new Response('{}',{status:429}))
    const response=await POST(request('{}'))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(mocks.limiter).toHaveBeenCalledWith('fly:7')
    expect(mocks.db).not.toHaveBeenCalled()
  })
  it('rejects malformed, oversized and arbitrary-command inputs',async()=>{
    expect((await POST(request('invalid'))).status).toBe(400)
    expect((await POST(request(' '.repeat(20001)))).status).toBe(413)
    expect((await POST(request(JSON.stringify({...payload,command:'unexpected'})))).status).toBe(400)
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('passes only authenticated workspace ownership and gives unknown failures no fallback',async()=>{
    expect((await POST(request(JSON.stringify(payload)))).status).toBe(202)
    expect(mocks.submit).toHaveBeenCalledWith({},expect.objectContaining({runtime:'command'}),7,'operator')
    mocks.submit.mockImplementationOnce(()=>{throw Error('database unavailable')})
    const response=await POST(request(JSON.stringify(payload)))
    expect(response.status).toBe(503)
    expect(await response.json()).not.toHaveProperty('safe_local_fallback',true)
  })
})
