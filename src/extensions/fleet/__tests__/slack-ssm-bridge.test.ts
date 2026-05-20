import { describe, expect, it, vi, beforeEach } from 'vitest'

const ssmSendMock = vi.fn()
const loggerErrorMock = vi.fn()

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn().mockImplementation(() => ({ send: ssmSendMock })),
  PutParameterCommand: vi.fn().mockImplementation((input: unknown) => ({
    __type: 'PutParameterCommand',
    input,
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn() },
}))

const importBridge = async () => import('../lib/slack-ssm-bridge')

beforeEach(() => {
  ssmSendMock.mockReset()
  loggerErrorMock.mockReset()
})

describe('slackConfigSsmName', () => {
  it('matches the terraform aws_ssm_parameter.slack_config.name convention', async () => {
    const { slackConfigSsmName } = await importBridge()
    expect(
      slackConfigSsmName('ender-stack', 'dev', 'hello-bot'),
    ).toBe('/ender-stack/dev/companion-openclaw/hello-bot/slack-config')
  })

  it('preserves project/env segments verbatim for multi-tenant paths', async () => {
    const { slackConfigSsmName } = await importBridge()
    expect(
      slackConfigSsmName('tenant-alpha', 'staging', 'support'),
    ).toBe('/tenant-alpha/staging/companion-openclaw/support/slack-config')
  })
})

describe('writeSlackChannelConfigToSsm — happy path', () => {
  it('returns ok=true with the ssm name and calls PutParameterCommand once', async () => {
    ssmSendMock.mockResolvedValueOnce({ Version: 1, Tier: 'Standard' })
    const { writeSlackChannelConfigToSsm } = await importBridge()
    const result = await writeSlackChannelConfigToSsm({
      projectName: 'ender-stack',
      environment: 'dev',
      agentName: 'hello-bot',
      channelsConfigJson: '{"channels":[{"id":"C0123456789","requireMention":true}]}',
    })
    expect(result).toEqual({
      ok: true,
      ssmName: '/ender-stack/dev/companion-openclaw/hello-bot/slack-config',
    })
    expect(ssmSendMock).toHaveBeenCalledTimes(1)
  })

  it('sends SecureString + Overwrite=true with the exact JSON value', async () => {
    ssmSendMock.mockResolvedValueOnce({ Version: 1 })
    const { writeSlackChannelConfigToSsm } = await importBridge()
    const json = '{"channels":[{"id":"C0123456789","requireMention":true}]}'
    await writeSlackChannelConfigToSsm({
      projectName: 'ender-stack',
      environment: 'dev',
      agentName: 'hello-bot',
      channelsConfigJson: json,
    })
    const call = ssmSendMock.mock.calls[0][0] as { input: Record<string, unknown> }
    expect(call.input.Name).toBe(
      '/ender-stack/dev/companion-openclaw/hello-bot/slack-config',
    )
    expect(call.input.Type).toBe('SecureString')
    expect(call.input.Overwrite).toBe(true)
    expect(call.input.Value).toBe(json)
  })

  it('does not log on success', async () => {
    ssmSendMock.mockResolvedValueOnce({ Version: 1 })
    const { writeSlackChannelConfigToSsm } = await importBridge()
    await writeSlackChannelConfigToSsm({
      projectName: 'p',
      environment: 'e',
      agentName: 'a',
      channelsConfigJson: '{"channels":[]}',
    })
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })
})

describe('writeSlackChannelConfigToSsm — failure', () => {
  it('returns ok=false with errorName/errorMessage instead of throwing', async () => {
    const err = Object.assign(new Error('throttled'), {
      name: 'ThrottlingException',
    })
    ssmSendMock.mockRejectedValueOnce(err)
    const { writeSlackChannelConfigToSsm } = await importBridge()
    const result = await writeSlackChannelConfigToSsm({
      projectName: 'ender-stack',
      environment: 'dev',
      agentName: 'hello-bot',
      channelsConfigJson: '{"channels":[]}',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorName).toBe('ThrottlingException')
      expect(result.errorMessage).toBe('throttled')
      expect(result.ssmName).toBe(
        '/ender-stack/dev/companion-openclaw/hello-bot/slack-config',
      )
    }
  })

  it('logs the failure with structured fields (agentName, ssmName, errorName, errorMessage)', async () => {
    const err = Object.assign(new Error('access denied'), {
      name: 'AccessDeniedException',
    })
    ssmSendMock.mockRejectedValueOnce(err)
    const { writeSlackChannelConfigToSsm } = await importBridge()
    await writeSlackChannelConfigToSsm({
      projectName: 'ender-stack',
      environment: 'dev',
      agentName: 'hello-bot',
      channelsConfigJson: '{"channels":[]}',
    })
    expect(loggerErrorMock).toHaveBeenCalledTimes(1)
    const [fields, msg] = loggerErrorMock.mock.calls[0]
    expect(fields).toMatchObject({
      agentName: 'hello-bot',
      ssmName: '/ender-stack/dev/companion-openclaw/hello-bot/slack-config',
      errorName: 'AccessDeniedException',
      errorMessage: 'access denied',
    })
    expect(typeof msg).toBe('string')
  })

  it('handles errors without `name` (UnknownError fallback)', async () => {
    ssmSendMock.mockRejectedValueOnce({ message: 'weird' })
    const { writeSlackChannelConfigToSsm } = await importBridge()
    const result = await writeSlackChannelConfigToSsm({
      projectName: 'p',
      environment: 'e',
      agentName: 'a',
      channelsConfigJson: '{}',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorName).toBe('UnknownError')
      expect(result.errorMessage).toBe('weird')
    }
  })
})
