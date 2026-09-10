import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Chat folder order API', () => {
  test('PUT + GET roundtrip is shared', async ({ request }) => {
    const order = [`folder:e2e-${Date.now()}`, 'folder:general']
    const putRes = await request.put('/api/chat/folder-order', {
      headers: API_KEY_HEADER,
      data: { order },
    })
    expect(putRes.status()).toBe(200)
    const putBody = await putRes.json()
    expect(putBody.ok).toBeTruthy()
    expect(putBody.order).toEqual(order)

    const getRes = await request.get('/api/chat/folder-order', { headers: API_KEY_HEADER })
    expect(getRes.status()).toBe(200)
    const getBody = await getRes.json()
    expect(getBody.order.slice(0, 2)).toEqual(order)
  })

  test('PUT rejects a non-array order', async ({ request }) => {
    const res = await request.put('/api/chat/folder-order', {
      headers: API_KEY_HEADER,
      data: { order: 'nope' },
    })
    expect(res.status()).toBe(400)
  })
})
