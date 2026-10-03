import { describe, expect, it } from 'vitest'
import { __testables } from '@/lib/task-dispatch'
import { getZcodeLaunch } from '@/lib/zcode-sessions'

// Opt-in integration check against a real ZCode install. It spends the operator's
// subscription quota, so it stays skipped unless ZCODE_E2E=1 and ZCODE_CLI_BIN are set.
const { callZcodeViaCli } = __testables as unknown as {
  callZcodeViaCli: (
    task: unknown,
    prompt: string,
    session?: { resume?: string },
  ) => Promise<{ text: string | null; sessionId: string | null }>
}

const enabled = process.env.ZCODE_E2E === '1' && !!process.env.ZCODE_CLI_BIN
const TOKEN = 'ZCODE-E2E-TOKEN-7431'

function task(): Record<string, unknown> {
  return {
    id: 900001,
    title: 'zcode e2e',
    description: null,
    status: 'assigned',
    priority: 'medium',
    assigned_to: 'zcode-e2e',
    workspace_id: 1,
    agent_name: 'zcode-e2e',
    agent_id: 900001,
    agent_config: null,
    metadata: JSON.stringify({ dispatchMode: 'plan' }),
  }
}

describe.skipIf(!enabled)('live ZCode dispatch', () => {
  it('resolves the configured CLI bundle', () => {
    expect(getZcodeLaunch()).not.toBeNull()
  })

  it('runs a headless prompt and returns a resumable session id', async () => {
    const first = await callZcodeViaCli(task(), `Reply with exactly: ${TOKEN}`)
    expect(first.text).toContain(TOKEN)
    expect(first.sessionId).toMatch(/^sess_[0-9a-f-]{36}$/)

    const resumed = await callZcodeViaCli(
      task(),
      'Repeat back only the token from my previous message.',
      { resume: first.sessionId! },
    )
    expect(resumed.text).toContain(TOKEN)
  }, 240_000)
})
