const { createHash } = require('node:crypto')

function createFlyTools(api) {
  return [{
    name: 'mc_submit_fly_leaf',
    description: 'Admit one clean pushed-revision build/test leaf to Mission Control. Defaults to command checks: local Claude subscription reasoning, Fly compute only. Accepted jobs remain remotely owned; poll mc_fly_status and never duplicate them locally. A local response explicitly permits local work. No direct Fly calls, dirty worktrees, deploys, migrations, secrets, review or Mac-only work.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        title: { type: 'string' }, description: { type: 'string' },
        repository: { type: 'string', description: 'Approved HTTPS GitHub .git URL' },
        base_sha: { type: 'string', description: 'Clean pushed 40-character Git commit SHA' },
        runtime: { type: 'string', enum: ['command','claude','codex'], default: 'command' },
        setup: { type: 'string', enum: ['none','npm-ci','pnpm-ci','npm-ci-playwright','pnpm-ci-playwright'] },
        checks: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', enum: ['smoke','test','lint','typecheck','build'] } },
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
        try { return await api('POST','/api/fly/submit',payload) }
        catch (error) { last = error; if (!attempt) await new Promise(resolve => setTimeout(resolve,500)) }
      }
      throw new Error(`Admission not confirmed. Retry request_id=${payload.request_id} unchanged; do not execute locally. ${last?.message || 'Request failed'}`)
    },
  }, {
    name: 'mc_fly_status',
    description: 'Read Fly readiness, durable queue, result, worker count and estimated compute cost. No mutation; authoritative remote ownership survives client disconnects.',
    inputSchema: { type: 'object', properties: { submission_id: { type: 'string' } } },
    handler: async args => api('GET', `/api/fly/status${args.submission_id ? '?submission_id='+encodeURIComponent(args.submission_id) : ''}`),
  }]
}

module.exports = { createFlyTools }
