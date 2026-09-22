import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { JevAssistantDraft } from '../src/lib/jev-assistant-schema'

const projects = [
  { id: 101, name: 'Mission Control', slug: 'mission-control', ticket_prefix: 'MC', status: 'active', github_repo: 'example/mission-control' },
  { id: 102, name: 'Example API', slug: 'example-api', ticket_prefix: 'API', status: 'active', github_repo: 'example/api' },
]

const policy = {
  id: 901, workspace_id: 1, project_id: 101, name: 'Release confidence',
  description: 'Assess release evidence before shipping', model: 'jev-latest', mode: 'shadow',
  enabled: true, created_by: 'testadmin', created_at: 1, updated_at: 1,
  questions: {
    ready: { type: 'noul', instructions: 'Is the release evidence sufficient?' },
    risk: { type: 'choice', instructions: 'Which risk dominates?', criteria: { security: 'Security gap', reliability: 'Reliability gap', none: 'No material gap' } },
    evidence: { type: 'score', instructions: 'Rate evidence quality', criteria: ['Weak', 'Adequate', 'Strong'] },
  },
}

const assistant = {
  draft: {
    summary: 'Independently assess release readiness, dominant risk, and evidence quality.',
    name: policy.name, description: policy.description, questions: policy.questions,
    tests: ['Validate every answer contract', 'Exercise timeout and malformed responses'],
    risks: ['Repository evidence may be incomplete', 'Thresholds require calibration'],
    observability: ['Record model, latency, usage, and request ID'], warnings: [], clarifications: [] as JevAssistantDraft['clarifications'],
  },
  configuration: {
    scope: 'selected', projectIds: [101], trigger: 'manual', enforcement: 'advisory',
    contextMode: 'safe_repository', failureMode: 'retry_then_review', rollout: 'shadow',
    retainPreview: false, uncertaintyThreshold: 0.65,
    tests: ['Validate every answer contract'], risks: ['Repository evidence may be incomplete'],
    observability: ['Record model, latency, usage, and request ID'],
  },
  provider: { kind: 'claude-cli', model: 'haiku' }, warnings: [],
}

async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: {
    username: process.env.E2E_AUTH_USER || 'testadmin',
    password: process.env.E2E_AUTH_PASS || 'testpass1234!',
  } })
  expect(response.status()).toBe(200)
  const fullMode = await page.request.put('/api/settings', { data: {
    settings: { 'general.interface_mode': 'full' },
  } })
  expect(fullMode.status()).toBe(200)
  const onboarding = await page.request.post('/api/onboarding', {
    data: { action: 'skip' },
  })
  expect(onboarding.status()).toBe(200)
  await page.addInitScript(() => {
    window.sessionStorage.setItem('mc-onboarding-dismissed', '1')
  })
}

async function mockJev(page: Page, clarify = false) {
  let saved = false
  let assistantCalled = false
  let latestDraft = assistant.draft
  const session = {
    id: '5fb298ef-4d06-4e03-b76b-f74687c8fc44', workspace_id: 1, project_id: 101,
    created_by_user_id: 1, title: 'Assess release readiness', provider: 'claude-cli', model: 'haiku',
    status: 'draft', primary_policy_id: null, created_at: 1, updated_at: 1, archived_at: null,
  }
  await page.route('**/api/projects', (route) => route.fulfill({ json: { projects } }))
  await page.route('**/api/jev/status', (route) => route.fulfill({ json: { status: {
    configured: true, healthy: true, healthError: null, lastCheckedAt: 1,
    assistantAvailable: true, assistantProvider: 'Claude CLI (no tools)',
    defaultModel: 'jev-latest', sdkVersion: '0.5.7', policyCount: 0,
    evaluationCount: 0, successfulCount: 0, lastEvaluationAt: null,
    cloud: { configured: true, project: 'Webdev', state: 'synced', pending: 0, synced: 1,
      lastSyncedAt: 1, errorCode: null },
  } } }))
  await page.route(/\/api\/jev\/sessions(?:\?.*)?$/, (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 201, json: { session } })
    return route.fulfill({ json: { sessions: [session] } })
  })
  await page.route(/\/api\/jev\/sessions\/[^/]+\/messages(?:\?.*)?$/, (route) => route.fulfill({
    json: { messages: assistantCalled ? [{
      id: 1, workspace_id: 1, session_id: session.id, ordinal: 1, role: 'user',
      content: JSON.stringify({ goal: session.title, answers: {}, projectIds: [101] }),
      provider: null, model: null, status: 'complete', created_at: 1,
    }] : [] },
  }))
  await page.route(/\/api\/jev\/sessions\/[^/?]+$/, (route) => route.fulfill({ json: {
    session, latestRevision: assistantCalled ? {
      id: 1, workspace_id: 1, session_id: session.id, revision_no: 1,
      draft: latestDraft, configuration: assistant.configuration, provider: 'claude-cli',
      model: 'haiku', status: 'validated', created_at: 1,
    } : null,
  } }))
  await page.route('**/api/jev/assistant', (route) => {
    latestDraft = { ...assistant.draft, clarifications: clarify && !assistantCalled ? [{
      id: 'clarify_evidence', title: 'Which evidence should this review?', help: 'Choose the evidence boundary.', options: [
        { value: 'docs', label: 'Release documents', consequence: 'Review the supplied release notes.', recommended: true },
        { value: 'tests', label: 'Test results', consequence: 'Review the supplied test results.', recommended: false },
      ],
    }] : [] }
    assistantCalled = true
    return route.fulfill({ json: { ...assistant, draft: latestDraft, session: { id: session.id, revisionNo: 1 } } })
  })
  await page.route('**/api/jev/policies/bulk', (route) => {
    saved = true
    return route.fulfill({ status: 201, json: { policies: [policy] } })
  })
  await page.route(/\/api\/jev\/policies\?projectId=/, (route) => route.fulfill({ json: { policies: saved ? [policy] : [] } }))
  await page.route('**/api/jev/context?*', (route) => route.fulfill({ json: { context: {
    source: 'local', localAvailable: true, includedFiles: ['README.md', 'package.json'], trackedFileCount: 128,
    warnings: [], state: { repository: { name: 'Mission Control' }, structure: { representativeFiles: ['src/app/page.tsx', 'src/lib/jev-client.ts'] }, privacy: 'Secrets and raw source excluded.' },
  } } }))
  await page.route('**/api/jev/evaluations?*', (route) => route.fulfill({ json: { evaluations: [] } }))
  await page.route('**/api/jev/evaluations', (route) => route.fulfill({ status: 201, json: { evaluation: {
    id: 'eval-1', model: 'jev-1.13.0', latencyMs: 84, requestId: 'req-synthetic',
    usage: { input_tokens: 240, output_tokens: 12 },
    answers: {
      ready: { type: 'noul', noul: 0.82 },
      risk: { type: 'choice', choice: 'none', confidence: 0.74, probabilities: { security: 0.08, reliability: 0.12, none: 0.8 } },
      evidence: { type: 'score', score: 1.7, confidence: 0.78, legend: { 0: 'Weak', 1: 'Adequate', 2: 'Strong' }, probabilities: { 0: 0.05, 1: 0.2, 2: 0.75 } },
    },
  } } }))
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' })
}

test('novice setup through reviewed Jev result', async ({ page }, testInfo) => {
  await login(page)
  await mockJev(page)
  await page.goto('/jev')
  await expect(page.getByText('What do you want evaluated?')).toBeVisible()
  await shot(page, testInfo, '01-describe')
  await page.getByLabel('What do you want Jev to evaluate?').fill('Assess release readiness across selected repositories, including tests, security, rollback, and observability.')
  await page.getByRole('button', { name: 'Customize setup' }).click()
  await shot(page, testInfo, '02-clarify-scope')
  await page.getByRole('button', { name: /Selected repositories/ }).click()
  await expect(page.getByText('Choose repositories')).toBeVisible()
  for (const answer of ['Recommend for me', 'Safe repository snapshot', 'Advisory', 'Manually', 'Retry, then review', 'Production-ready checks']) {
    await page.getByRole('button', { name: new RegExp(answer) }).click()
  }
  await expect(page.getByText('Review before saving the policy')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Draft questions' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Draft questions' }).getByText('Is the release evidence sufficient?', { exact: true })).toBeInViewport()
  await expect(page.getByLabel('Purpose', { exact: true })).toBeHidden()
  await expect(page.getByLabel('Editable Jev schema')).toBeHidden()
  await shot(page, testInfo, '03-review-schema')
  await page.getByRole('button', { name: /Save to 1 repository/ }).click()
  await expect(page.getByRole('region', { name: 'Jev sorter workspace' })).toBeVisible()
  await page.getByRole('button', { name: 'Load repository context' }).click()
  await expect(page.getByText(/Context ready\./)).toBeVisible()
  await shot(page, testInfo, '04-context-preview')
  await page.getByRole('button', { name: 'Prepare dataset' }).click()
  await page.getByRole('button', { name: '▷ Run 1' }).click()
  await expect(page.getByText(/Evaluation complete/)).toBeVisible()
  const result = page.getByRole('region', { name: 'Jev dataset results' })
  await expect(result).toBeVisible()
  await result.scrollIntoViewIfNeeded()
  await shot(page, testInfo, '05-evaluation-result')

  // The session steps and the route back to setup must survive scrolling to
  // the results, otherwise the only way back disappears exactly when a user
  // has finished reading a run and wants to change the questions.
  const steps = page.getByRole('navigation', { name: 'Jev session steps' })
  const back = page.getByRole('button', { name: '\u2190 Back to setup' })
  await expect(steps).toBeInViewport()
  await expect(back).toBeInViewport()
  await back.click()
  await expect(page.getByRole('region', { name: 'Jev sorter workspace' })).toBeHidden()
  await expect(page.getByText('Review before saving the policy')).toBeVisible()
  await shot(page, testInfo, '06-back-to-setup')
})

test('adaptive clarification survives chat selection and supports visual editing', async ({ page }, testInfo) => {
  await login(page)
  await mockJev(page, true)
  await page.goto('/jev')
  await page.getByLabel('What do you want Jev to evaluate?').fill('Help me decide what needs attention.')
  await page.getByRole('button', { name: 'Use recommended setup' }).click()
  await expect(page.getByText('Which evidence should this review?')).toBeVisible()
  await shot(page, testInfo, '06-adaptive-clarification')
  await page.getByRole('button', { name: /Release documents/ }).click()
  await expect(page.getByRole('region', { name: 'Draft questions' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit evidence', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Edit question' })).toBeVisible()
  await page.getByLabel('Question', { exact: true }).fill('How complete is the supplied release evidence?')
  await shot(page, testInfo, '07-visual-score-editor')
  await page.getByRole('button', { name: 'Save question' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit question' })).toBeHidden()
  await expect(page.getByRole('region', { name: 'Draft questions' }).getByText('How complete is the supplied release evidence?', { exact: true })).toBeVisible()
  await shot(page, testInfo, '08-visual-review')
})
