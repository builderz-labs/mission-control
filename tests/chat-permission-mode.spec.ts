import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Chat permission mode API', () => {
  test('operator can toggle bypass and read it back', async ({ request }) => {
    const putRes = await request.put('/api/chat/permission-mode', {
      headers: API_KEY_HEADER,
      data: { mode: 'bypass' },
    })
    expect(putRes.status()).toBe(200)
    const putBody = await putRes.json()
    expect(putBody.mode).toBe('bypass')
    expect(putBody.allowed).toBeTruthy()

    const getRes = await request.get('/api/chat/permission-mode', { headers: API_KEY_HEADER })
    expect(getRes.status()).toBe(200)
    const getBody = await getRes.json()
    expect(getBody.mode).toBe('bypass')
    expect(getBody.allowed).toBeTruthy()

    const clear = await request.put('/api/chat/permission-mode', {
      headers: API_KEY_HEADER,
      data: { mode: 'ask' },
    })
    expect(clear.status()).toBe(200)
    expect((await clear.json()).mode).toBe('ask')
  })

  test('PUT rejects unknown modes', async ({ request }) => {
    const res = await request.put('/api/chat/permission-mode', {
      headers: API_KEY_HEADER,
      data: { mode: 'yolo' },
    })
    expect(res.status()).toBe(400)
  })
})
