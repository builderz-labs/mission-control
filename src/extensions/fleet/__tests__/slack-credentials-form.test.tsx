import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SlackCredentialsForm } from '../panels/slack-credentials-form'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

const AGENT = 'hello-bot'

const validTokens = {
  appToken: 'xapp-1-A12345678-1234567890-abcdef0123456789',
  botToken: 'xoxb-12345-67890-abcdefABCDEFabcdef-extra',
  signingSecret: 'a'.repeat(32),
}

const fillAll = () => {
  fireEvent.change(screen.getByTestId('slack-credentials-app-token'), {
    target: { value: validTokens.appToken },
  })
  fireEvent.change(screen.getByTestId('slack-credentials-bot-token'), {
    target: { value: validTokens.botToken },
  })
  fireEvent.change(screen.getByTestId('slack-credentials-signing-secret'), {
    target: { value: validTokens.signingSecret },
  })
}

const okResp = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
  }) as unknown as Response

const errResp = (status: number, body: unknown) =>
  ({
    ok: false,
    status,
    json: async () => body,
  }) as unknown as Response

describe('<SlackCredentialsForm />', () => {
  it('renders three masked inputs + Save button (disabled until all filled)', () => {
    render(<SlackCredentialsForm agentName={AGENT} onSaved={vi.fn()} />)
    const app = screen.getByTestId('slack-credentials-app-token')
    const bot = screen.getByTestId('slack-credentials-bot-token')
    const sig = screen.getByTestId('slack-credentials-signing-secret')
    // type=password masks the input.
    expect(app.getAttribute('type')).toBe('password')
    expect(bot.getAttribute('type')).toBe('password')
    expect(sig.getAttribute('type')).toBe('password')
    // Submit disabled until all three filled.
    expect(
      (screen.getByTestId('slack-credentials-submit') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('enables Save once all three fields are filled', () => {
    render(<SlackCredentialsForm agentName={AGENT} onSaved={vi.fn()} />)
    fillAll()
    expect(
      (screen.getByTestId('slack-credentials-submit') as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('rejects malformed appToken client-side without firing the request', async () => {
    render(<SlackCredentialsForm agentName={AGENT} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByTestId('slack-credentials-app-token'), {
      target: { value: 'not-an-app-token' },
    })
    fireEvent.change(screen.getByTestId('slack-credentials-bot-token'), {
      target: { value: validTokens.botToken },
    })
    fireEvent.change(screen.getByTestId('slack-credentials-signing-secret'), {
      target: { value: validTokens.signingSecret },
    })
    fireEvent.click(screen.getByTestId('slack-credentials-submit'))
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-credentials-app-token-error'),
      ).toBeInTheDocument(),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects too-short signingSecret client-side', async () => {
    render(<SlackCredentialsForm agentName={AGENT} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByTestId('slack-credentials-app-token'), {
      target: { value: validTokens.appToken },
    })
    fireEvent.change(screen.getByTestId('slack-credentials-bot-token'), {
      target: { value: validTokens.botToken },
    })
    fireEvent.change(screen.getByTestId('slack-credentials-signing-secret'), {
      target: { value: 'short' },
    })
    fireEvent.click(screen.getByTestId('slack-credentials-submit'))
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-credentials-signing-secret-error'),
      ).toBeInTheDocument(),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs valid tokens to the encoded URL and shows success on 200', async () => {
    // Mock matches the actual SlackCredentialsResponse shape from
    // slack-credentials.ts (taskDefinitionArn, not newTaskDefArn).
    fetchMock.mockResolvedValueOnce(
      okResp({
        ok: true,
        agentName: AGENT,
        taskDefinitionArn: 'arn:td:6',
        deploymentId: 'ecs-svc/12345',
        secretArns: {
          appToken: 'arn:1',
          botToken: 'arn:2',
          signingSecret: 'arn:3',
        },
      }),
    )
    const onSaved = vi.fn()
    render(<SlackCredentialsForm agentName={AGENT} onSaved={onSaved} />)
    fillAll()
    fireEvent.click(screen.getByTestId('slack-credentials-submit'))
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-credentials-success'),
      ).toBeInTheDocument(),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      `/api/fleet/agents/${AGENT}/slack/credentials`,
    )
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual(validTokens)
    // onSaved is now `() => void` — no response argument.
    expect(onSaved).toHaveBeenCalledWith()
  })

  it('passes encoded agentName in the URL (defense-in-depth)', async () => {
    fetchMock.mockResolvedValueOnce(okResp({ ok: true }))
    // Use a name that includes a hyphen — exercises encoding path.
    render(
      <SlackCredentialsForm agentName="agent-1" onSaved={vi.fn()} />,
    )
    fillAll()
    fireEvent.click(screen.getByTestId('slack-credentials-submit'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/fleet/agents/agent-1/slack/credentials')
  })

  it('clears token state from React on success (defense against accidental leakage)', async () => {
    fetchMock.mockResolvedValueOnce(okResp({ ok: true }))
    render(<SlackCredentialsForm agentName={AGENT} onSaved={vi.fn()} />)
    fillAll()
    fireEvent.click(screen.getByTestId('slack-credentials-submit'))
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-credentials-success'),
      ).toBeInTheDocument(),
    )
    // After success, the rotate button is shown — clicking it
    // re-renders the form. Token fields should now be empty.
    fireEvent.click(screen.getByTestId('slack-credentials-rotate'))
    expect(
      (screen.getByTestId(
        'slack-credentials-app-token',
      ) as HTMLInputElement).value,
    ).toBe('')
    expect(
      (screen.getByTestId(
        'slack-credentials-bot-token',
      ) as HTMLInputElement).value,
    ).toBe('')
    expect(
      (screen.getByTestId(
        'slack-credentials-signing-secret',
      ) as HTMLInputElement).value,
    ).toBe('')
  })

  it('surfaces server-side fieldErrors as inline field errors', async () => {
    fetchMock.mockResolvedValueOnce(
      errResp(400, {
        error: 'InvalidTokenShape',
        fieldErrors: {
          botToken: 'Bot token format invalid (server check)',
        },
      }),
    )
    render(<SlackCredentialsForm agentName={AGENT} onSaved={vi.fn()} />)
    fillAll()
    fireEvent.click(screen.getByTestId('slack-credentials-submit'))
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-credentials-bot-token-error'),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByTestId('slack-credentials-bot-token-error').textContent,
    ).toContain('server check')
  })

  it('surfaces NetworkError when fetch throws (round-3 audit symmetry with picker)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    render(<SlackCredentialsForm agentName={AGENT} onSaved={vi.fn()} />)
    fillAll()
    fireEvent.click(screen.getByTestId('slack-credentials-submit'))
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-credentials-error'),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByTestId('slack-credentials-error').textContent,
    ).toContain('NetworkError')
  })

  it('renders generic error block on 502 AWSError', async () => {
    fetchMock.mockResolvedValueOnce(
      errResp(502, { error: 'AccessDeniedException' }),
    )
    render(<SlackCredentialsForm agentName={AGENT} onSaved={vi.fn()} />)
    fillAll()
    fireEvent.click(screen.getByTestId('slack-credentials-submit'))
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-credentials-error'),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByTestId('slack-credentials-error').textContent,
    ).toContain('AccessDeniedException')
  })

  it('resets form state when agentName changes', () => {
    const { rerender } = render(
      <SlackCredentialsForm agentName="agent-a" onSaved={vi.fn()} />,
    )
    fillAll()
    rerender(
      <SlackCredentialsForm agentName="agent-b" onSaved={vi.fn()} />,
    )
    expect(
      (screen.getByTestId(
        'slack-credentials-app-token',
      ) as HTMLInputElement).value,
    ).toBe('')
  })
})
