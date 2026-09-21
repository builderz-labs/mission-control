import { createHash } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { sorterEvaluation, sorterPolicy } from '../src/components/panels/jev/jev-sorter.fixtures'
import type { JevEvaluation } from '../src/lib/jev-types'

async function setup(page: Page) {
  expect((await page.request.post('/api/auth/login', { data: {
    username: process.env.E2E_AUTH_USER || 'testadmin', password: process.env.E2E_AUTH_PASS || 'testpass1234!',
  } })).status()).toBe(200)
  await page.request.put('/api/settings', { data: { settings: { 'general.interface_mode': 'full' } } })
  await page.request.post('/api/onboarding', { data: { action: 'skip' } })
  await page.addInitScript(() => window.sessionStorage.setItem('mc-onboarding-dismissed', '1'))
  const project = { id: 2, name: 'Synthetic UI checks', slug: 'synthetic-ui', ticket_prefix: 'UI', status: 'active' }
  const session = { id: '6ca4c047-2a26-40f9-aaaf-bec4a1d09754', workspace_id: 1, project_id: 2,
    created_by_user_id: 1, created_by_principal: null, title: 'Sorter browser check', status: 'ready',
    primary_policy_id: 7, provider: 'claude-cli', model: 'haiku', created_at: 1, updated_at: 1, archived_at: null }
  let policy = structuredClone(sorterPolicy)
  const evaluations: JevEvaluation[] = []
  await page.route('**/api/projects', (route) => route.fulfill({ json: { projects: [project] } }))
  await page.route('**/api/jev/status', (route) => route.fulfill({ json: { status: {
    configured: true, healthy: true, assistantAvailable: true, assistantProvider: 'Claude CLI (no tools)',
    assistantDefault: 'claude-cli', defaultModel: 'jev-latest', sdkVersion: '0.5.7',
    cloud: { configured: true, project: 'Webdev', state: 'synced', pending: 0, synced: 1, lastSyncedAt: 1 },
  } } }))
  await page.route('**/api/jev/sessions?*', (route) => route.fulfill({ json: { sessions: [session] } }))
  await page.route('**/api/jev/policies?*', (route) => route.fulfill({ json: { policies: [policy] } }))
  await page.route('**/api/jev/policies/7', (route) => {
    policy = { ...policy, ...route.request().postDataJSON() }
    return route.fulfill({ json: { policy } })
  })
  await page.route('**/api/jev/evaluations?*', (route) => route.fulfill({ json: { evaluations } }))
  await page.route('**/api/jev/evaluations', (route) => {
    const body = route.request().postDataJSON()
    const hash = createHash('sha256').update(typeof body.state === 'string' ? body.state : JSON.stringify(body.state)).digest('hex')
    const entry = sorterEvaluation({ id: body.idempotencyKey, state_sha256: hash, questions: policy.questions, completed_at: evaluations.length + 2 })
    evaluations.unshift(entry)
    return route.fulfill({ status: 201, json: { evaluation: { id: entry.id, model: entry.model_resolved,
      answers: entry.answers, usage: { input_tokens: 10, output_tokens: 3 }, requestId: null, latencyMs: 42 } } })
  })
  await page.goto('/jev')
  return { session, evaluations }
}

test('saved chat opens the sorter, edits questions, runs a dataset and restores results', async ({ page }, info) => {
  const { session, evaluations } = await setup(page)
  await page.getByRole('button', { name: session.title, exact: true }).click()
  await expect(page.getByRole('region', { name: 'Jev sorter workspace' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('01-empty-sorter.png'), fullPage: true })
  for (const name of ['Ready', 'Kind', 'Quality']) {
    await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Edit question' })).toBeVisible()
    await page.screenshot({ path: info.outputPath(`02-editor-${name}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Save question', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
  }
  await page.getByLabel('Context format', { exact: true }).selectOption('dataset')
  await page.getByLabel('Context Jev will evaluate', { exact: true }).fill('[{"text":"Synthetic release note"}]')
  await page.getByRole('button', { name: 'Prepare dataset', exact: true }).click()
  await expect(page.getByRole('button', { name: '▷ Run 1', exact: true })).toBeEnabled()
  expect(evaluations).toHaveLength(0)
  await page.screenshot({ path: info.outputPath('03-reviewed-dataset.png'), fullPage: true })
  await page.getByRole('button', { name: '▷ Run 1', exact: true }).click()
  await expect(page.getByText(/Evaluation complete/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ready: Yes, 1 items' })).toBeEnabled()
  await page.getByRole('button', { name: 'Ready: Yes, 1 items' }).click()
  await expect(page.getByRole('button', { name: 'Clear Ready filter' })).toBeVisible()
  for (const scope of ['25', '100', 'all', 'unsorted']) await page.getByLabel('Run scope').selectOption(scope)
  expect(evaluations).toHaveLength(1)
  await expect(page.getByRole('button', { name: '▷ Run', exact: true })).toBeDisabled()
  await page.getByRole('region', { name: 'Jev dataset results' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('04-results.png'), fullPage: true })
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '↓ Export JSON' }).click()
  expect((await download).suggestedFilename()).toBe('jev-results-7.json')
  await page.reload()
  await page.getByRole('button', { name: session.title, exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ready: Yes, 1 items' })).toBeVisible()
  await expect(page.getByLabel('Context Jev will evaluate')).toHaveValue('')
  await page.screenshot({ path: info.outputPath('05-restored-chat.png'), fullPage: true })
})

for (const [width, height] of [[390, 844], [1024, 768], [1440, 900]]) {
  test(`sorter is usable at ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height })
    const { session } = await setup(page)
    if (width < 768) await page.getByRole('button', { name: 'Browse', exact: true }).click()
    await page.getByRole('button', { name: session.title, exact: true }).click()
    await expect(page.getByRole('region', { name: 'Jev sorter workspace' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Edit Ready', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.screenshot({ path: info.outputPath(`06-responsive-${width}.png`), fullPage: true })
  })
}
