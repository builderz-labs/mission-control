import { expect, test } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

test.describe('Projects CRUD', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup.splice(0)) {
      await request.delete(`/api/projects/${id}?mode=delete`, { headers: API_KEY_HEADER }).catch(() => {})
    }
  })

  test('create, update ticket prefix, archive, and delete project', async ({ request }) => {
    const base = uid().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)

    const createRes = await request.post('/api/projects', {
      headers: API_KEY_HEADER,
      data: {
        name: `E2E Project ${uid()}`,
        ticket_prefix: `${base}A`,
        description: 'created by e2e',
      },
    })
    expect(createRes.status()).toBe(201)
    const createBody = await createRes.json()
    const id = createBody.project?.id as number
    cleanup.push(id)
    expect(createBody.project.ticket_prefix).toBe(`${base}A`)

    const patchRes = await request.patch(`/api/projects/${id}`, {
      headers: API_KEY_HEADER,
      data: {
        ticket_prefix: `${base}B`,
        description: 'updated by e2e',
      },
    })
    expect(patchRes.status()).toBe(200)
    const patchBody = await patchRes.json()
    expect(patchBody.project.ticket_prefix).toBe(`${base}B`)

    const archiveRes = await request.patch(`/api/projects/${id}`, {
      headers: API_KEY_HEADER,
      data: { status: 'archived' },
    })
    expect(archiveRes.status()).toBe(200)
    const archiveBody = await archiveRes.json()
    expect(archiveBody.project.status).toBe('archived')

    const listRes = await request.get('/api/projects?includeArchived=1', { headers: API_KEY_HEADER })
    expect(listRes.status()).toBe(200)
    const listBody = await listRes.json()
    expect(listBody.projects.some((p: any) => p.id === id && p.ticket_prefix === `${base}B`)).toBe(true)

    const deleteRes = await request.delete(`/api/projects/${id}?mode=delete`, { headers: API_KEY_HEADER })
    expect(deleteRes.status()).toBe(200)
    const deleteBody = await deleteRes.json()
    expect(deleteBody.success).toBe(true)

    const getDeleted = await request.get(`/api/projects/${id}`, { headers: API_KEY_HEADER })
    expect(getDeleted.status()).toBe(404)

    cleanup.length = 0
  })

  test('rejects duplicate ticket prefix in the same workspace', async ({ request }) => {
    const base = uid().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    const prefix = `${base}X`

    const firstRes = await request.post('/api/projects', {
      headers: API_KEY_HEADER,
      data: {
        name: `E2E Dup One ${uid()}`,
        ticket_prefix: prefix,
      },
    })
    expect(firstRes.status()).toBe(201)
    const firstBody = await firstRes.json()
    cleanup.push(firstBody.project.id)

    const secondRes = await request.post('/api/projects', {
      headers: API_KEY_HEADER,
      data: {
        name: `E2E Dup Two ${uid()}`,
        ticket_prefix: prefix,
      },
    })
    expect(secondRes.status()).toBe(409)
  })
})
