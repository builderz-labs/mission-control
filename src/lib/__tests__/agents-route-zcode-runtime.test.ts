import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAgentSchema } from '@/lib/validation'

const routeSource = readFileSync(join(process.cwd(), 'src', 'app', 'api', 'agents', 'route.ts'), 'utf8')

describe('agent runtime_type vocabulary for zcode', () => {
  it('accepts zcode when an agent is created', () => {
    expect(createAgentSchema.safeParse({ name: 'zc', runtime_type: 'zcode' }).success).toBe(true)
    expect(createAgentSchema.safeParse({ name: 'zc', runtime_type: 'not-a-runtime' }).success).toBe(false)
  })

  it('accepts zcode in the update whitelist', () => {
    const whitelist = routeSource.match(/const allowedRuntimes = \[[^\]]*\]/)
    expect(whitelist, 'allowedRuntimes list missing from agents route').toBeTruthy()
    expect(whitelist?.[0]).toContain("'zcode'")
  })

  it('retires the zcode base session when the agent opts out of the runtime', () => {
    // Mirrors the claude rule (#602): authority is the opt-in, so the captured
    // session must not outlive it.
    const block = routeSource.slice(
      routeSource.indexOf('if (runtime_type !== undefined)'),
      routeSource.indexOf("fieldsToUpdate.push('updated_at = ?')"),
    )
    expect(routeSource).toContain("import { rotateZcodeBaseSession } from '@/lib/zcode-agent-sessions'")
    expect(block).toContain("=== 'zcode' && runtime_type !== 'zcode'")
    expect(block).toContain('rotateZcodeBaseSession(agent.id')
    expect(block.indexOf('rotateClaudeBaseSession')).toBeLessThan(block.indexOf('rotateZcodeBaseSession'))
  })
})
