import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SlackManifestDisplay } from '../panels/slack-manifest-display'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

const AGENT = 'hello-bot'

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

const sampleManifest = {
  display_information: { name: 'mc-agent-hello-bot' },
  features: { bot_user: { display_name: 'hello-bot' } },
  oauth_config: { scopes: { bot: ['channels:read', 'chat:write'] } },
  settings: { socket_mode_enabled: true },
}

const sampleSuccess = {
  ok: true as const,
  agentName: AGENT,
  manifest: sampleManifest,
  instructions: [
    // Step 1 contains a URL — used by the linkify test below to
    // verify the panel hyperlinks rather than rendering plain text.
    'Go to https://api.slack.com/apps and click "Create New App".',
    'Choose "From an app manifest", select your workspace, click Next.',
  ],
}

describe('<SlackManifestDisplay />', () => {
  it('renders nothing when agentName is null and does not fetch', () => {
    const { container } = render(<SlackManifestDisplay agentName={null} />)
    expect(container.firstChild).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows loading state while fetch is in flight', async () => {
    const deferred: { resolve?: (v: Response) => void } = {}
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        deferred.resolve = resolve
      }),
    )
    render(<SlackManifestDisplay agentName={AGENT} />)
    expect(
      await screen.findByTestId('slack-manifest-loading'),
    ).toBeInTheDocument()
    // Resolve the pending fetch so the test cleanup doesn't leave a
    // dangling promise after the assertions.
    deferred.resolve?.(okResp(sampleSuccess))
  })

  it('renders the manifest JSON + instructions on 200', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleSuccess))
    render(<SlackManifestDisplay agentName={AGENT} />)
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-manifest-display'),
      ).toBeInTheDocument(),
    )
    const json = screen.getByTestId('slack-manifest-json')
    expect(json.textContent).toContain('socket_mode_enabled')
    expect(json.textContent).toContain('mc-agent-hello-bot')

    const instructions = screen.getByTestId('slack-manifest-instructions')
    const items = instructions.querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Create New App')
  })

  it('fetches from the correct endpoint URL', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleSuccess))
    render(<SlackManifestDisplay agentName={AGENT} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`/api/fleet/agents/${AGENT}/slack/manifest`)
  })

  it('renders error UI on 404 ServiceNotFoundException', async () => {
    fetchMock.mockResolvedValueOnce(
      errResp(404, {
        error: 'ServiceNotFoundException',
        detail: `agent "${AGENT}" not found`,
      }),
    )
    render(<SlackManifestDisplay agentName={AGENT} />)
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-manifest-error'),
      ).toBeInTheDocument(),
    )
    expect(screen.getByTestId('slack-manifest-error').textContent).toContain(
      'ServiceNotFoundException',
    )
    expect(screen.getByTestId('slack-manifest-error').textContent).toContain(
      'HTTP 404',
    )
  })

  it('renders error UI on bare network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    render(<SlackManifestDisplay agentName={AGENT} />)
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-manifest-error'),
      ).toBeInTheDocument(),
    )
    expect(screen.getByTestId('slack-manifest-error').textContent).toContain(
      'NetworkError',
    )
  })

  it('copies the manifest JSON to clipboard on Copy button click', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleSuccess))
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    })
    render(<SlackManifestDisplay agentName={AGENT} />)
    const copyBtn = await screen.findByTestId('slack-manifest-copy')
    fireEvent.click(copyBtn)
    await waitFor(() =>
      expect(writeTextMock).toHaveBeenCalledWith(
        JSON.stringify(sampleManifest, null, 2),
      ),
    )
    // Button label updates to "Copied!"
    await waitFor(() =>
      expect(screen.getByTestId('slack-manifest-copy').textContent).toBe(
        'Copied!',
      ),
    )
  })

  it('keeps the Copy label if clipboard write throws (operator can retry)', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleSuccess))
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('NotAllowed')),
      },
    })
    render(<SlackManifestDisplay agentName={AGENT} />)
    const copyBtn = await screen.findByTestId('slack-manifest-copy')
    fireEvent.click(copyBtn)
    // Wait a tick for the failed promise to settle, then assert
    // label has NOT flipped to "Copied!"
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByTestId('slack-manifest-copy').textContent).toBe('Copy')
  })

  it('hyperlinks URLs in instruction text with target=_blank rel=noreferrer', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleSuccess))
    render(<SlackManifestDisplay agentName={AGENT} />)
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-manifest-instructions'),
      ).toBeInTheDocument(),
    )
    const instructions = screen.getByTestId('slack-manifest-instructions')
    const link = instructions.querySelector('a[href="https://api.slack.com/apps"]')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('target')).toBe('_blank')
    expect(link!.getAttribute('rel')).toBe('noreferrer')
    // Plain text without URLs renders as plain text (no <a>).
    expect(instructions.textContent).toContain('Choose "From an app manifest"')
  })

  it('surfaces a Timeout error (not stuck loading) when fetch is aborted by the timeout', async () => {
    // Pre-fix, the catch had `if (controller.signal.aborted) return`
    // which fired for BOTH timeout-abort and cleanup-abort,
    // silently swallowing timeouts and leaving the UI on
    // "Loading…" forever. Post-fix: distinguished via a
    // `timedOut` flag; timeout-abort surfaces an error UI with
    // the Retry button.
    fetchMock.mockImplementationOnce((_url, init) => {
      // Simulate a timeout: never resolve until the AbortSignal
      // fires (which the wrapper's setTimeout triggers after
      // FETCH_TIMEOUT_MS). The mock rejects with an AbortError
      // when the signal aborts.
      return new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit).signal as AbortSignal
        signal.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    vi.useFakeTimers()
    render(<SlackManifestDisplay agentName={AGENT} />)
    // Advance past FETCH_TIMEOUT_MS (10s).
    await vi.advanceTimersByTimeAsync(11_000)
    vi.useRealTimers()
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-manifest-error'),
      ).toBeInTheDocument(),
    )
    expect(screen.getByTestId('slack-manifest-error').textContent).toContain(
      'Timeout',
    )
    // Retry button is offered (operator can recover).
    expect(screen.getByTestId('slack-manifest-retry')).toBeInTheDocument()
  })

  it('does not linkify a trailing period after a URL', async () => {
    fetchMock.mockResolvedValueOnce(
      okResp({
        ...sampleSuccess,
        instructions: ['Go to https://api.slack.com/apps.'],
      }),
    )
    render(<SlackManifestDisplay agentName={AGENT} />)
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-manifest-instructions'),
      ).toBeInTheDocument(),
    )
    const link = screen
      .getByTestId('slack-manifest-instructions')
      .querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://api.slack.com/apps')
    // Period should be rendered as plain text, not part of the href.
    expect(
      screen.getByTestId('slack-manifest-instructions').textContent,
    ).toContain('.')
  })

  it('Retry button re-fetches the manifest after an error', async () => {
    fetchMock
      .mockResolvedValueOnce(
        errResp(502, { error: 'AWSError', detail: 'transient' }),
      )
      .mockResolvedValueOnce(okResp(sampleSuccess))
    render(<SlackManifestDisplay agentName={AGENT} />)
    const errorEl = await screen.findByTestId('slack-manifest-error')
    expect(errorEl).toBeInTheDocument()
    const retry = screen.getByTestId('slack-manifest-retry')
    fireEvent.click(retry)
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-manifest-display'),
      ).toBeInTheDocument(),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('resets the copied flag when agentName changes (round-3 audit fix)', async () => {
    fetchMock
      .mockResolvedValueOnce(okResp(sampleSuccess))
      .mockResolvedValueOnce(okResp({ ...sampleSuccess, agentName: 'other' }))
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } })
    const { rerender } = render(<SlackManifestDisplay agentName={AGENT} />)
    // Wait for first fetch + Copy.
    const copyBtn = await screen.findByTestId('slack-manifest-copy')
    fireEvent.click(copyBtn)
    await waitFor(() =>
      expect(screen.getByTestId('slack-manifest-copy').textContent).toBe(
        'Copied!',
      ),
    )
    // Switch to a different agent — should reset to "Copy".
    rerender(<SlackManifestDisplay agentName="other" />)
    await waitFor(() =>
      expect(screen.getByTestId('slack-manifest-copy').textContent).toBe(
        'Copy',
      ),
    )
  })

  it('re-fetches when agentName changes', async () => {
    fetchMock
      .mockResolvedValueOnce(okResp(sampleSuccess))
      .mockResolvedValueOnce(okResp({ ...sampleSuccess, agentName: 'other' }))
    const { rerender } = render(<SlackManifestDisplay agentName={AGENT} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    rerender(<SlackManifestDisplay agentName="other" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [secondUrl] = fetchMock.mock.calls[1]
    expect(String(secondUrl)).toBe('/api/fleet/agents/other/slack/manifest')
  })
})
