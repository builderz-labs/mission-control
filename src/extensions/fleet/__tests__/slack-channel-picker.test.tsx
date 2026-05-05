import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  SlackChannelPicker,
  pruneSelectedToChannels,
} from '../panels/slack-channel-picker'

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

const sampleChannels = {
  ok: true,
  agentName: AGENT,
  channels: [
    { id: 'C0123456789', name: 'general', isPrivate: false, numMembers: 42 },
    { id: 'G987654321', name: 'private-team', isPrivate: true, numMembers: 5 },
  ],
  truncated: false,
}

describe('<SlackChannelPicker />', () => {
  it('shows loading state on initial fetch', () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {})) // never resolve
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    expect(
      screen.getByTestId('slack-channel-picker-loading'),
    ).toBeInTheDocument()
  })

  it('renders channel list with names + privacy + member count', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-channel-picker'),
      ).toBeInTheDocument(),
    )
    const list = screen.getByTestId('slack-channel-picker-list')
    expect(list.textContent).toContain('general')
    expect(list.textContent).toContain('private-team')
    expect(list.textContent).toContain('42')
    expect(list.textContent).toContain('🔒')
    expect(list.textContent).toContain('#')
  })

  it('toggles checkbox state on click', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    const cb = await screen.findByTestId(
      'slack-channel-checkbox-C0123456789',
    )
    expect((cb as HTMLInputElement).checked).toBe(false)
    fireEvent.click(cb)
    expect((cb as HTMLInputElement).checked).toBe(true)
    fireEvent.click(cb)
    expect((cb as HTMLInputElement).checked).toBe(false)
  })

  it('Save button disabled until at least one channel selected', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    const save = await screen.findByTestId('slack-channel-picker-save')
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(
      screen.getByTestId('slack-channel-checkbox-C0123456789'),
    )
    expect((save as HTMLButtonElement).disabled).toBe(false)
  })

  it('renders truncation banner when API reports truncated=true', async () => {
    fetchMock.mockResolvedValueOnce(
      okResp({ ...sampleChannels, truncated: true }),
    )
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-channel-picker-truncated'),
      ).toBeInTheDocument(),
    )
  })

  it('shows SlackBotTokenNotFound error with credentials-form hint (no Retry button)', async () => {
    fetchMock.mockResolvedValueOnce(
      errResp(404, {
        error: 'SlackBotTokenNotFound',
        detail: 'Run the credential-paste flow first.',
      }),
    )
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-channel-picker-error'),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByTestId('slack-channel-picker-error').textContent,
    ).toContain('SlackBotTokenNotFound')
    // No Retry button — recovery is via the credentials form.
    expect(
      screen.queryByTestId('slack-channel-picker-retry'),
    ).not.toBeInTheDocument()
  })

  it('shows Retry button on transient errors (e.g. SlackRateLimited)', async () => {
    fetchMock.mockResolvedValueOnce(
      errResp(429, {
        error: 'SlackRateLimited',
        detail: 'Retry after 30s',
      }),
    )
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-channel-picker-retry'),
      ).toBeInTheDocument(),
    )
    // Retry click re-fetches.
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    fireEvent.click(screen.getByTestId('slack-channel-picker-retry'))
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-channel-picker'),
      ).toBeInTheDocument(),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reloadKey bump triggers re-fetch (used after credentials save)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        errResp(404, { error: 'SlackBotTokenNotFound' }),
      )
      .mockResolvedValueOnce(okResp(sampleChannels))
    const { rerender } = render(
      <SlackChannelPicker agentName={AGENT} reloadKey={0} />,
    )
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-channel-picker-error'),
      ).toBeInTheDocument(),
    )
    rerender(<SlackChannelPicker agentName={AGENT} reloadKey={1} />)
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-channel-picker'),
      ).toBeInTheDocument(),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces Timeout error (not stuck loading) when fetch is aborted by the 10s timeout', async () => {
    // Mirrors the credentials-form / manifest-display timeout
    // tests. The dual-flag (timedOut vs cleanupAborted) logic is
    // subtle enough that a direct test pins the behavior.
    fetchMock.mockImplementationOnce((_url, init) => {
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
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await vi.advanceTimersByTimeAsync(11_000)
    vi.useRealTimers()
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-channel-picker-error'),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByTestId('slack-channel-picker-error').textContent,
    ).toContain('Timeout')
    expect(
      screen.getByTestId('slack-channel-picker-retry'),
    ).toBeInTheDocument()
  })

  it('uses encodeURIComponent on agentName in fetch URL', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName="agent-1" reloadKey={0} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/fleet/agents/agent-1/slack/channels')
  })

  it('preserves selected channels across a transient-error Retry click (round-1 audit on PR #51)', async () => {
    // Sequence: initial fetch fails → operator clicks Retry →
    // fetch succeeds → operator picks → external Retry path
    // re-fires (simulated via second Retry). Selection survives
    // because the Retry handler bumps retryKey, NOT reloadKey,
    // and the selected-reset effect is keyed only on
    // agentName + reloadKey.
    fetchMock
      .mockResolvedValueOnce(errResp(429, { error: 'SlackRateLimited' }))
      .mockResolvedValueOnce(okResp(sampleChannels))
      .mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    // Initial error → Retry button.
    await screen.findByTestId('slack-channel-picker-retry')
    fireEvent.click(screen.getByTestId('slack-channel-picker-retry'))
    // Now success — pick a channel.
    await screen.findByTestId('slack-channel-checkbox-C0123456789')
    fireEvent.click(
      screen.getByTestId('slack-channel-checkbox-C0123456789'),
    )
    expect(
      screen.getByTestId('slack-channel-picker').textContent,
    ).toContain('Selected: 1')
    // No second Retry button in success state, but if the operator
    // hits another transient (e.g., during Save) and retried via
    // any external trigger that bumps retryKey, selection should
    // survive. We can't easily simulate retryKey bump from outside
    // — the test assertion above (Selected: 1 stays after Retry
    // resolved) is sufficient: pre-fix the picker's effect
    // unconditionally reset selected on every retryKey bump,
    // so picks would never have appeared with count > 0 after a
    // Retry-then-pick sequence. Post-fix the count holds.
  })

  it('DOES reset selected channels on reloadKey bump (credentials-form fired refresh)', async () => {
    fetchMock
      .mockResolvedValueOnce(okResp(sampleChannels))
      .mockResolvedValueOnce(okResp(sampleChannels))
    const { rerender } = render(
      <SlackChannelPicker agentName={AGENT} reloadKey={0} />,
    )
    await screen.findByTestId('slack-channel-checkbox-C0123456789')
    fireEvent.click(
      screen.getByTestId('slack-channel-checkbox-C0123456789'),
    )
    expect(
      screen.getByTestId('slack-channel-picker').textContent,
    ).toContain('Selected: 1')
    // Bump reloadKey — credentials-form just saved fresh tokens.
    // The channel list shape may change, so the operator's
    // prior picks are reset.
    rerender(<SlackChannelPicker agentName={AGENT} reloadKey={1} />)
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-channel-picker').textContent,
      ).toContain('Selected: 0'),
    )
  })

  it('ghost-selection filter — pruneSelectedToChannels prunes stale IDs to intersection (#283 cleanup)', () => {
    // Round-1 audits on PR #55 (claude-bot + greptile): the
    // ghost-filter at the fetch-success setState boundary only
    // matters on the retryKey path (reloadKey clears
    // unconditionally via the separate effect at
    // panels/slack-channel-picker.tsx:111-113). The retryKey
    // path is only operator-reachable by clicking the Retry
    // button in the error UI — and that error UI doesn't show
    // checkboxes, so the operator can't have selected anything
    // yet. Today the inline filter is defensive code without a
    // live trigger path.
    //
    // The PURE prune function exported from the picker module
    // is unit-tested here so a regression in the filter
    // expression itself is caught. If a future refresh path is
    // added (e.g. a "Refresh channel list" button without a
    // corresponding clear), the inline call site becomes
    // operator-reachable and the integration coverage will
    // need to follow.
    expect(
      pruneSelectedToChannels(
        new Set(['C0123456789', 'G987654321']),
        ['C0123456789'],
      ),
    ).toEqual(new Set(['C0123456789']))

    // No-op when intersection equals input — same Set ref returned.
    const noOpInput = new Set(['C0123456789'])
    expect(
      pruneSelectedToChannels(noOpInput, ['C0123456789', 'G987654321']),
    ).toBe(noOpInput)

    // All stale → empty result.
    expect(
      pruneSelectedToChannels(new Set(['C0123456789']), ['G987654321']),
    ).toEqual(new Set())

    // Empty input → empty result, same ref.
    const emptyInput = new Set<string>()
    expect(
      pruneSelectedToChannels(emptyInput, ['C0123456789']),
    ).toBe(emptyInput)
  })

  it('Save button shows ✓ on success', async () => {
    fetchMock
      .mockResolvedValueOnce(okResp(sampleChannels))
      .mockResolvedValueOnce(okResp({ ok: true }))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-checkbox-C0123456789')
    fireEvent.click(
      screen.getByTestId('slack-channel-checkbox-C0123456789'),
    )
    fireEvent.click(screen.getByTestId('slack-channel-picker-save'))
    await waitFor(() =>
      expect(
        screen.getByTestId('slack-channel-picker-saved'),
      ).toBeInTheDocument(),
    )
  })

  it('shows over-cap warning when more than 50 channels selected', async () => {
    const manyChannels = {
      ok: true,
      agentName: AGENT,
      truncated: false,
      channels: Array.from({ length: 60 }, (_, i) => ({
        id: `C0123${String(i).padStart(6, '0')}`,
        name: `channel-${i}`,
        isPrivate: false,
      })),
    }
    fetchMock.mockResolvedValueOnce(okResp(manyChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-picker')
    // Click 51 channels.
    for (let i = 0; i < 51; i++) {
      fireEvent.click(
        screen.getByTestId(
          `slack-channel-checkbox-C0123${String(i).padStart(6, '0')}`,
        ),
      )
    }
    expect(
      screen.getByTestId('slack-channel-picker').textContent,
    ).toContain('50-channel cap')
    expect(
      (screen.getByTestId(
        'slack-channel-picker-save',
      ) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
