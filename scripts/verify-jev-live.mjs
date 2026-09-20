const baseUrl = (process.env.MC_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '')
const apiKey = (process.env.MC_API_KEY || process.env.API_KEY || '').trim()
if (!apiKey) throw new Error('Mission Control API credential is not configured')

const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' }

async function request(path, options = {}) {
  const attempts = options.method && options.method !== 'GET' ? 1 : 3
  let status = 0
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options, headers: { ...headers, ...options.headers }, signal: controller.signal,
      })
      status = response.status
      if (response.ok) return response.status === 204 ? null : response.json()
      if (response.status === 429 && attempt < attempts - 1) {
        const retryAfter = Math.min(Number(response.headers.get('retry-after') || 1), 10)
        await response.body?.cancel().catch(() => undefined)
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1_000))
        continue
      }
      if (response.status < 500 || attempt === attempts - 1) break
      await response.body?.cancel().catch(() => undefined)
    } catch {
      if (attempt === attempts - 1) break
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`Mission Control request failed with HTTP ${status || 'unavailable'}`)
}

const health = await request('/api/health')
if (health?.status !== 'ok') throw new Error('Mission Control health check failed')

const [{ status }, { projects }] = await Promise.all([
  request('/api/jev/status'), request('/api/projects'),
])
if (!status?.configured) throw new Error('Jev is not configured')
if (!Array.isArray(projects) || projects.length === 0) throw new Error('No repository projects are available')

const contexts = []
for (const project of projects) {
  const payload = await request(`/api/jev/context?projectId=${project.id}`)
  const context = payload?.context
  const serialized = JSON.stringify(context?.state ?? null)
  if (!context || serialized.length > 200_000) throw new Error(`Invalid context snapshot for project ${project.id}`)
  if (/\b(?:sk|ghp|doppler)[-_][A-Za-z0-9_-]{12,}\b/i.test(serialized)) {
    throw new Error(`Credential-like content reached the context snapshot for project ${project.id}`)
  }
  contexts.push({ project: project.name, source: context.source, bytes: serialized.length })
}

const project = projects.find((item) => item.slug === 'mission-control') ?? projects[0]
const name = `Jev live verification ${Date.now()}`
let policy
try {
  const created = await request('/api/jev/policies', {
    method: 'POST', body: JSON.stringify({
      projectId: project.id, name, description: 'Temporary synthetic production verification.',
      model: 'jev-latest', mode: 'shadow', enabled: true,
      questions: {
        connectivity: { type: 'noul', instructions: 'Is this explicitly a synthetic verification?' },
        decision: { type: 'choice', instructions: 'Classify the verification.', criteria: { synthetic: 'Synthetic test data', real: 'Real repository data' } },
        confidence: { type: 'score', instructions: 'Rate how clearly synthetic this state is.', criteria: ['Unclear', 'Clear', 'Explicitly synthetic'] },
      },
    }),
  })
  policy = created.policy
  const run = await request('/api/jev/evaluations', {
    method: 'POST', body: JSON.stringify({
      projectId: project.id, policyId: policy.id,
      state: { synthetic: true, purpose: 'Mission Control Jev live verification; no repository content.' },
      retainStatePreview: false,
    }),
  })
  if (!run?.evaluation?.model || Object.keys(run.evaluation.answers ?? {}).length !== 3) {
    throw new Error('Jev live evaluation returned an incomplete typed result')
  }
  const models = await request('/api/jev/models')
  if (!Array.isArray(models?.models) || models.models.length === 0) throw new Error('Jev model inventory is empty')
  console.log(JSON.stringify({
    ok: true, projectsVerified: contexts.length,
    localContexts: contexts.filter((item) => item.source === 'local').length,
    metadataContexts: contexts.filter((item) => item.source !== 'local').length,
    typedAnswers: Object.keys(run.evaluation.answers).length,
    model: run.evaluation.model,
  }))
} finally {
  if (policy) {
    await request(`/api/jev/policies/${policy.id}?projectId=${project.id}`, { method: 'DELETE' })
  }
}
