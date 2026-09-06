const { createHash } = require('node:crypto')
const { validateAdmission, validateStatus, validateCancellation, retryRead } = require('./mc-fly-contract.cjs')

function createFlyTools(api) {
  return [{
    name: 'mc_submit_fly_leaf',
    description: 'Admit one clean pushed-revision build/test leaf to Mission Control. Defaults to command checks: local active-agent reasoning, Fly compute only. Accepted jobs remain remotely owned; poll mc_fly_status and never duplicate them locally. Local fallback also requires healthy host disk and no offload-required flag. No direct Fly calls, dirty worktrees, deploys, migrations, secrets, review or Mac-only work.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        title: { type: 'string' }, description: { type: 'string' },
        repository: { type: 'string', description: 'Approved HTTPS GitHub .git URL' },
        base_sha: { type: 'string', description: 'Clean pushed 40-character Git commit SHA' },
        runtime: { type: 'string', enum: ['command','claude','codex'], default: 'command' },
        setup: { type: 'string', enum: ['none','npm-ci','pnpm-ci','npm-ci-playwright','pnpm-ci-playwright'] },
        checks: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', enum: ['smoke','test','lint','typecheck','build','test:e2e'] } },
        timeout_seconds: { type: 'integer', minimum: 60, maximum: 1800 },
        estimated_minutes: { type: 'number', minimum: 1, maximum: 30 },
        priority: { type: 'string', enum: ['low','medium','high','critical'] },
        request_id: { type: 'string', description: 'Stable leaf ID; reuse unchanged for retries' },
        session_id: { type: 'string' }, swarm_id: { type: 'string' },
      },
      required: ['title','description','repository','base_sha'],
    },
    handler: async args => {
      const payload = { ...args, runtime: args.runtime || 'command' }
      payload.request_id ||= createHash('sha256').update(JSON.stringify(payload)).digest('hex')
      let last
      for (let attempt = 0; attempt < 2; attempt++) {
        try { return validateAdmission(await api('POST','/api/fly/submit',payload)) }
        catch (error) { last = error; if (!attempt) await new Promise(resolve => setTimeout(resolve,500)) }
      }
      throw new Error(`Admission not confirmed. Retry request_id=${payload.request_id} unchanged; do not execute locally. ${last?.message || 'Request failed'}`)
    },
  }, {
    name: 'mc_fly_status',
    description: 'Read Fly readiness, durable queue, result, worker count and estimated compute cost. No mutation; authoritative remote ownership survives client disconnects.',
    inputSchema: { type: 'object', properties: { submission_id: { type: 'string' }, session_id: { type: 'string', maxLength: 200 } } },
    handler: async args => {
      const params = new URLSearchParams()
      if (args.submission_id) params.set('submission_id',args.submission_id)
      if (args.session_id) params.set('session_id',args.session_id)
      return retryRead(async () => validateStatus(await api('GET', '/api/fly/status?'+params)))
    },
  }, {
    name: 'mc_cancel_fly_leaf',
    description: 'Cancel queued, unlaunched work. Never releases active or unknown launches; only safe_local_fallback=true permits local execution subject to host disk policy.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { submission_id: { type: 'string', pattern: '^[a-f0-9]{32}$' } }, required: ['submission_id'] },
    handler: async args => {
      if (!/^[a-f0-9]{32}$/.test(args.submission_id || '')) throw new Error('Invalid submission ID')
      return retryRead(async () => validateCancellation(await api('DELETE','/api/fly/status?submission_id='+encodeURIComponent(args.submission_id))))
    },
  }]
}

module.exports = { createFlyTools }
