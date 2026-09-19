import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Docs Knowledge API', () => {
  test('tree/search/content flows for markdown knowledge docs', async ({ request }) => {
    const stamp = Date.now()
    const path = `openclaw/e2e-kb-${stamp}.md`
    const content = `# E2E Knowledge ${stamp}\n\nDeployment runbook token: kb-search-${stamp}`

    const create = await request.post('/api/memory', {
      headers: API_KEY_HEADER,
      data: {
        action: 'create',
        path,
        content,
      },
    })
    expect(create.status()).toBe(200)

    const tree = await request.get('/api/docs/tree', { headers: API_KEY_HEADER })
    expect(tree.status()).toBe(200)
    const treeBody = await tree.json()
    expect(Array.isArray(treeBody.tree)).toBe(true)

    const search = await request.get(`/api/docs/search?q=${encodeURIComponent(`kb-search-${stamp}`)}`, {
      headers: API_KEY_HEADER,
    })
    expect(search.status()).toBe(200)
    const searchBody = await search.json()
    const found = searchBody.results.find((r: any) => r.path === path)
    expect(found).toBeTruthy()

    const doc = await request.get(`/api/docs/content?path=${encodeURIComponent(path)}`, {
      headers: API_KEY_HEADER,
    })
    expect(doc.status()).toBe(200)
    const docBody = await doc.json()
    expect(docBody.path).toBe(path)
    expect(docBody.content).toContain(`kb-search-${stamp}`)

    const cleanup = await request.delete('/api/memory', {
      headers: API_KEY_HEADER,
      data: {
        action: 'delete',
        path,
      },
    })
    expect(cleanup.status()).toBe(200)
  })

  test('docs APIs require auth', async ({ request }) => {
    const tree = await request.get('/api/docs/tree')
    expect(tree.status()).toBe(401)

    const search = await request.get('/api/docs/search?q=deployment')
    expect(search.status()).toBe(401)

    const content = await request.get('/api/docs/content?path=knowledge-base/example.md')
    expect(content.status()).toBe(401)
  })
})
