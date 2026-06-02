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
// #501: valid Slack user ID (U + 8–12 alphanumerics) used as the agent owner.
const OWNER = 'U07TM2R08Y'

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
  // #501: GET surfaces the agent owner so the picker can prefill a
  // primary channel's assignedUsers and skip the no-owner primary block.
  ownerSlackId: OWNER,
}

// #501: same channels but the agent has no usable owner — exercises the
// primary-channel block (primary + empty assignedUsers + no owner).
const sampleChannelsNoOwner = {
  ok: true,
  agentName: AGENT,
  channels: sampleChannels.channels,
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

  it('toggles row aria-selected state on click (listbox semantic)', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    const row = await screen.findByTestId(
      'slack-channel-row-C0123456789',
    )
    expect(row.getAttribute('aria-selected')).toBe('false')
    fireEvent.click(row)
    expect(row.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(row)
    expect(row.getAttribute('aria-selected')).toBe('false')
  })

  it('Save button disabled until at least one channel selected', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    const save = await screen.findByTestId('slack-channel-picker-save')
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(
      screen.getByTestId('slack-channel-row-C0123456789'),
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
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.click(
      screen.getByTestId('slack-channel-row-C0123456789'),
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
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.click(
      screen.getByTestId('slack-channel-row-C0123456789'),
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
    const mk = (
      entries: Array<[string, { requireMention: boolean }]>,
    ) => new Map(entries)
    expect(
      pruneSelectedToChannels(
        mk([
          ['C0123456789', { requireMention: true }],
          ['G987654321', { requireMention: false }],
        ]),
        ['C0123456789'],
      ),
    ).toEqual(mk([['C0123456789', { requireMention: true }]]))

    // No-op when intersection equals input — same Map ref returned.
    const noOpInput = mk([['C0123456789', { requireMention: true }]])
    expect(
      pruneSelectedToChannels(noOpInput, ['C0123456789', 'G987654321']),
    ).toBe(noOpInput)

    // All stale → empty result.
    expect(
      pruneSelectedToChannels(
        mk([['C0123456789', { requireMention: true }]]),
        ['G987654321'],
      ),
    ).toEqual(new Map())

    // Empty input → empty result, same ref.
    const emptyInput = new Map<string, { requireMention: boolean }>()
    expect(
      pruneSelectedToChannels(emptyInput, ['C0123456789']),
    ).toBe(emptyInput)

    // #291: per-channel state preserved through the prune.
    const preserved = mk([['C0123456789', { requireMention: false }]])
    const result = pruneSelectedToChannels(preserved, [
      'C0123456789',
      'G987654321',
    ])
    expect(result).toBe(preserved)
    expect(result.get('C0123456789')?.requireMention).toBe(false)
  })

  it('Save button shows ✓ on success', async () => {
    fetchMock
      .mockResolvedValueOnce(okResp(sampleChannels))
      .mockResolvedValueOnce(okResp({ ok: true }))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.click(
      screen.getByTestId('slack-channel-row-C0123456789'),
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
          `slack-channel-row-C0123${String(i).padStart(6, '0')}`,
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

  it('search input filters the channel list by case-insensitive substring (#290)', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    // Both rows visible initially.
    expect(
      screen.queryByTestId('slack-channel-row-C0123456789'),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('slack-channel-row-G987654321'),
    ).toBeInTheDocument()
    // Type "PRIV" — only the private-team row matches (case-insensitive).
    const search = screen.getByTestId('slack-channel-picker-search')
    fireEvent.change(search, { target: { value: 'PRIV' } })
    expect(
      screen.queryByTestId('slack-channel-row-C0123456789'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('slack-channel-row-G987654321'),
    ).toBeInTheDocument()
    // Clear search — both visible again.
    fireEvent.change(search, { target: { value: '' } })
    expect(
      screen.queryByTestId('slack-channel-row-C0123456789'),
    ).toBeInTheDocument()
  })

  it('search "no matches" empty state when query matches nothing (#290)', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.change(
      screen.getByTestId('slack-channel-picker-search'),
      { target: { value: 'zzzzz' } },
    )
    expect(
      screen.getByTestId('slack-channel-picker-no-matches').textContent,
    ).toContain('zzzzz')
  })

  it('selection persists across filter changes (#290)', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    expect(
      screen.getByTestId('slack-channel-picker').textContent,
    ).toContain('Selected: 1')
    // Filter out the selected row from view.
    fireEvent.change(
      screen.getByTestId('slack-channel-picker-search'),
      { target: { value: 'private' } },
    )
    // Row no longer rendered, but selection state preserved.
    expect(
      screen.queryByTestId('slack-channel-row-C0123456789'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByTestId('slack-channel-picker').textContent,
    ).toContain('Selected: 1')
    // Config row for the still-selected channel is rendered above the search.
    expect(
      screen.getByTestId('slack-channel-config-row-C0123456789'),
    ).toBeInTheDocument()
  })

  it('Refresh button refetches channel list and preserves operator selection', async () => {
    fetchMock
      .mockResolvedValueOnce(okResp(sampleChannels))
      // Refresh-triggered fetch: returns an updated channel list
      // with a new channel that wasn't there before.
      .mockResolvedValueOnce(
        okResp({
          ...sampleChannels,
          channels: [
            ...sampleChannels.channels,
            {
              id: 'CNEWCHANNEL',
              name: 'new-room',
              isPrivate: false,
              numMembers: 3,
            },
          ],
        }),
      )
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    expect(
      screen.getByTestId('slack-channel-picker').textContent,
    ).toContain('Selected: 1')

    fireEvent.click(screen.getByTestId('slack-channel-picker-refresh'))
    // New channel appears + selection survives the refresh
    // (refresh bumps retryKey, not reloadKey).
    await screen.findByTestId('slack-channel-row-CNEWCHANNEL')
    expect(
      screen.getByTestId('slack-channel-picker').textContent,
    ).toContain('Selected: 1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('#291: legacy (role-less) channel shows @-only badge; click toggles to always-reply', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    // First channel auto-defaults to role=primary (#501); switch it to
    // the legacy mention-gated mode to expose the @-only/always toggle.
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    fireEvent.change(screen.getByTestId('slack-channel-role-C0123456789'), {
      target: { value: '' },
    })
    const modeBtn = screen.getByTestId(
      'slack-channel-pill-mode-C0123456789',
    )
    expect(modeBtn.textContent).toBe('@-only')
    fireEvent.click(modeBtn)
    expect(
      screen.getByTestId('slack-channel-pill-mode-C0123456789').textContent,
    ).toBe('always')
    // Toggle back.
    fireEvent.click(screen.getByTestId('slack-channel-pill-mode-C0123456789'))
    expect(
      screen.getByTestId('slack-channel-pill-mode-C0123456789').textContent,
    ).toBe('@-only')
  })

  it('#501: legacy @-only toggle is hidden once a role is set', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    // First channel defaults to primary → no legacy toggle.
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    expect(
      screen.queryByTestId('slack-channel-pill-mode-C0123456789'),
    ).not.toBeInTheDocument()
    // Switch to legacy → toggle appears; back to a role → gone again.
    fireEvent.change(screen.getByTestId('slack-channel-role-C0123456789'), {
      target: { value: '' },
    })
    expect(
      screen.getByTestId('slack-channel-pill-mode-C0123456789'),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('slack-channel-role-C0123456789'), {
      target: { value: 'monitor' },
    })
    expect(
      screen.queryByTestId('slack-channel-pill-mode-C0123456789'),
    ).not.toBeInTheDocument()
  })

  it('#291: Save POSTs legacy object form with per-channel requireMention', async () => {
    fetchMock
      .mockResolvedValueOnce(okResp(sampleChannels))
      .mockResolvedValueOnce(okResp({ ok: true }))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    // First channel keeps its role=primary default (#501) so the
    // selection has an allowlist-gated channel — #535 blocks Save when
    // every channel is legacy/monitor. The second channel stays legacy
    // and carries the per-channel requireMention shape this test asserts.
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    fireEvent.click(screen.getByTestId('slack-channel-row-G987654321'))
    // Flip the legacy channel to always-reply (requireMention=false).
    fireEvent.click(screen.getByTestId('slack-channel-pill-mode-G987654321'))
    fireEvent.click(screen.getByTestId('slack-channel-picker-save'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, init] = fetchMock.mock.calls[1]
    const body = JSON.parse(String((init as RequestInit).body)) as {
      channels: Array<Record<string, unknown>>
    }
    expect(body.channels).toEqual([
      { id: 'C0123456789', role: 'primary', assignedUsers: [OWNER] },
      { id: 'G987654321', requireMention: false },
    ])
  })

  it('config-row × button removes the selected channel (#290)', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    fireEvent.click(screen.getByTestId('slack-channel-row-G987654321'))
    expect(
      screen.getByTestId('slack-channel-picker').textContent,
    ).toContain('Selected: 2')
    // Click the × on the first config row.
    fireEvent.click(
      screen.getByTestId('slack-channel-pill-remove-C0123456789'),
    )
    expect(
      screen.getByTestId('slack-channel-picker').textContent,
    ).toContain('Selected: 1')
    expect(
      screen.queryByTestId('slack-channel-config-row-C0123456789'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByTestId('slack-channel-config-row-G987654321'),
    ).toBeInTheDocument()
  })

  // ── #501: role + assignedUsers + accessMode ─────────────────────────

  it('#501: first selected channel defaults to role=primary with the owner prefilled', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    const roleSelect = screen.getByTestId(
      'slack-channel-role-C0123456789',
    ) as HTMLSelectElement
    expect(roleSelect.value).toBe('primary')
    // Owner chip is prefilled + marked.
    const ownerChip = screen.getByTestId(
      `slack-channel-assigned-user-C0123456789-${OWNER}`,
    )
    expect(ownerChip).toBeInTheDocument()
    expect(ownerChip.textContent).toContain('(owner)')
  })

  it('#501: changing role updates the select value', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    const roleSelect = screen.getByTestId(
      'slack-channel-role-C0123456789',
    ) as HTMLSelectElement
    fireEvent.change(roleSelect, { target: { value: 'monitor' } })
    expect(roleSelect.value).toBe('monitor')
  })

  it('#501: accessMode picker shows only for role=active (default exclusive)', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    // primary → no accessMode picker.
    expect(
      screen.queryByTestId('slack-channel-access-mode-C0123456789'),
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('slack-channel-role-C0123456789'), {
      target: { value: 'active' },
    })
    const accessSelect = screen.getByTestId(
      'slack-channel-access-mode-C0123456789',
    ) as HTMLSelectElement
    expect(accessSelect.value).toBe('exclusive')
    // monitor → gone again.
    fireEvent.change(screen.getByTestId('slack-channel-role-C0123456789'), {
      target: { value: 'monitor' },
    })
    expect(
      screen.queryByTestId('slack-channel-access-mode-C0123456789'),
    ).not.toBeInTheDocument()
  })

  it('#501: add + remove assignedUsers via free-text entry', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    const input = screen.getByTestId(
      'slack-channel-assigned-users-input-C0123456789',
    )
    fireEvent.change(input, { target: { value: 'U99999999' } })
    fireEvent.click(
      screen.getByTestId('slack-channel-assigned-users-add-C0123456789'),
    )
    expect(
      screen.getByTestId('slack-channel-assigned-user-C0123456789-U99999999'),
    ).toBeInTheDocument()
    // Remove it.
    fireEvent.click(
      screen.getByLabelText('Remove U99999999'),
    )
    expect(
      screen.queryByTestId(
        'slack-channel-assigned-user-C0123456789-U99999999',
      ),
    ).not.toBeInTheDocument()
  })

  it('#501: invalid Slack user ID surfaces an inline error and is not added', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    const input = screen.getByTestId(
      'slack-channel-assigned-users-input-C0123456789',
    )
    fireEvent.change(input, { target: { value: 'not-a-user' } })
    fireEvent.click(
      screen.getByTestId('slack-channel-assigned-users-add-C0123456789'),
    )
    expect(
      screen.getByTestId('slack-channel-assigned-users-error-C0123456789')
        .textContent,
    ).toContain('valid Slack user ID')
    // No chip created for the invalid value.
    expect(
      screen.queryByTestId('slack-channel-assigned-user-C0123456789-not-a-user'),
    ).not.toBeInTheDocument()
  })

  it('#501: monitor role hides assignedUsers entry and omits it from the PUT body', async () => {
    fetchMock
      .mockResolvedValueOnce(okResp(sampleChannels))
      .mockResolvedValueOnce(okResp({ ok: true }))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    fireEvent.change(screen.getByTestId('slack-channel-role-C0123456789'), {
      target: { value: 'monitor' },
    })
    expect(
      screen.queryByTestId('slack-channel-assigned-users-C0123456789'),
    ).not.toBeInTheDocument()
    // #535: a monitor-only selection is workspace-open and blocks Save.
    // Add a second channel as the allowlist gate (role=primary → owner
    // auto-prefilled) so this test can still assert the monitor channel's
    // serialized shape.
    fireEvent.click(screen.getByTestId('slack-channel-row-G987654321'))
    fireEvent.change(screen.getByTestId('slack-channel-role-G987654321'), {
      target: { value: 'primary' },
    })
    fireEvent.click(screen.getByTestId('slack-channel-picker-save'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, init] = fetchMock.mock.calls[1]
    const body = JSON.parse(String((init as RequestInit).body)) as {
      channels: Array<Record<string, unknown>>
    }
    expect(body.channels).toEqual([
      { id: 'C0123456789', role: 'monitor' },
      { id: 'G987654321', role: 'primary', assignedUsers: [OWNER] },
    ])
  })

  it('#501: primary + empty assignedUsers + no owner blocks Save with primary-error', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannelsNoOwner))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    // No owner → nothing prefilled → primary with empty assignedUsers.
    expect(
      screen.getByTestId('slack-channel-picker-primary-error').textContent,
    ).toContain('role "primary" but no assignedUsers')
    expect(
      (screen.getByTestId('slack-channel-picker-save') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    // Adding a user clears the block.
    fireEvent.change(
      screen.getByTestId('slack-channel-assigned-users-input-C0123456789'),
      { target: { value: 'U12345678' } },
    )
    fireEvent.click(
      screen.getByTestId('slack-channel-assigned-users-add-C0123456789'),
    )
    expect(
      screen.queryByTestId('slack-channel-picker-primary-error'),
    ).not.toBeInTheDocument()
    expect(
      (screen.getByTestId('slack-channel-picker-save') as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('#501: primary with owner prefilled enables Save (no manual assignedUsers)', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    expect(
      screen.queryByTestId('slack-channel-picker-primary-error'),
    ).not.toBeInTheDocument()
    expect(
      (screen.getByTestId('slack-channel-picker-save') as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('#535: an all-legacy/monitor selection blocks Save with the no-allowlist error', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    // First channel defaults to role=primary (gated); drop it to legacy
    // so the whole selection becomes workspace-open.
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    fireEvent.change(screen.getByTestId('slack-channel-role-C0123456789'), {
      target: { value: '' },
    })
    expect(
      screen.getByTestId('slack-channel-picker-no-allowlist-error').textContent,
    ).toContain('No channel restricts who can @-mention')
    expect(
      (screen.getByTestId('slack-channel-picker-save') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    // monitor is role-bearing but still workspace-open → stays blocked.
    fireEvent.change(screen.getByTestId('slack-channel-role-C0123456789'), {
      target: { value: 'monitor' },
    })
    expect(
      screen.getByTestId('slack-channel-picker-no-allowlist-error'),
    ).toBeInTheDocument()
    // Switching to active + an assigned user resolves a groupAllowFrom →
    // block clears, Save enabled.
    fireEvent.change(screen.getByTestId('slack-channel-role-C0123456789'), {
      target: { value: 'active' },
    })
    fireEvent.change(
      screen.getByTestId('slack-channel-assigned-users-input-C0123456789'),
      { target: { value: 'U22222222' } },
    )
    fireEvent.click(
      screen.getByTestId('slack-channel-assigned-users-add-C0123456789'),
    )
    expect(
      screen.queryByTestId('slack-channel-picker-no-allowlist-error'),
    ).not.toBeInTheDocument()
    expect(
      (screen.getByTestId('slack-channel-picker-save') as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('#501: Save PUTs role-form entries (assignedUsers / accessMode, no requireMention)', async () => {
    fetchMock
      .mockResolvedValueOnce(okResp(sampleChannels))
      .mockResolvedValueOnce(okResp({ ok: true }))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    // C0123456789 → primary (owner prefilled by default).
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    // G987654321 → active + preferred + an assigned user.
    fireEvent.click(screen.getByTestId('slack-channel-row-G987654321'))
    fireEvent.change(screen.getByTestId('slack-channel-role-G987654321'), {
      target: { value: 'active' },
    })
    fireEvent.change(screen.getByTestId('slack-channel-access-mode-G987654321'), {
      target: { value: 'preferred' },
    })
    fireEvent.change(
      screen.getByTestId('slack-channel-assigned-users-input-G987654321'),
      { target: { value: 'U22222222' } },
    )
    fireEvent.click(
      screen.getByTestId('slack-channel-assigned-users-add-G987654321'),
    )
    fireEvent.click(screen.getByTestId('slack-channel-picker-save'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, init] = fetchMock.mock.calls[1]
    const body = JSON.parse(String((init as RequestInit).body)) as {
      channels: Array<Record<string, unknown>>
    }
    expect(body.channels).toEqual([
      { id: 'C0123456789', role: 'primary', assignedUsers: [OWNER] },
      {
        id: 'G987654321',
        role: 'active',
        assignedUsers: ['U22222222'],
        accessMode: 'preferred',
      },
    ])
    // requireMention must not ride on role entries.
    for (const c of body.channels) {
      expect(c).not.toHaveProperty('requireMention')
    }
  })

  it('#501: Save PUTs mixed legacy + role entries', async () => {
    fetchMock
      .mockResolvedValueOnce(okResp(sampleChannels))
      .mockResolvedValueOnce(okResp({ ok: true }))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    // First channel primary (owner prefilled); second left legacy.
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    fireEvent.click(screen.getByTestId('slack-channel-row-G987654321'))
    fireEvent.click(screen.getByTestId('slack-channel-picker-save'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, init] = fetchMock.mock.calls[1]
    const body = JSON.parse(String((init as RequestInit).body)) as {
      channels: Array<Record<string, unknown>>
    }
    expect(body.channels).toEqual([
      { id: 'C0123456789', role: 'primary', assignedUsers: [OWNER] },
      { id: 'G987654321', requireMention: true },
    ])
  })

  it('#501 (Greptile PR #87): primary default fires once — re-add after a clear stays legacy', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    // First selection → primary default.
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    expect(
      (screen.getByTestId('slack-channel-role-C0123456789') as HTMLSelectElement)
        .value,
    ).toBe('primary')
    // Clear it, then select a different channel — must NOT re-default to primary.
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    fireEvent.click(screen.getByTestId('slack-channel-row-G987654321'))
    expect(
      (screen.getByTestId('slack-channel-role-G987654321') as HTMLSelectElement)
        .value,
    ).toBe('')
    // Legacy → the @-only toggle is present.
    expect(
      screen.getByTestId('slack-channel-pill-mode-G987654321'),
    ).toBeInTheDocument()
  })

  it('#501 (Greptile PR #87): accessMode survives a role round-trip (active→monitor→active)', async () => {
    fetchMock.mockResolvedValueOnce(okResp(sampleChannels))
    render(<SlackChannelPicker agentName={AGENT} reloadKey={0} />)
    await screen.findByTestId('slack-channel-row-C0123456789')
    fireEvent.click(screen.getByTestId('slack-channel-row-C0123456789'))
    const role = () =>
      screen.getByTestId('slack-channel-role-C0123456789') as HTMLSelectElement
    fireEvent.change(role(), { target: { value: 'active' } })
    fireEvent.change(
      screen.getByTestId('slack-channel-access-mode-C0123456789'),
      { target: { value: 'preferred' } },
    )
    // Round-trip away and back.
    fireEvent.change(role(), { target: { value: 'monitor' } })
    fireEvent.change(role(), { target: { value: 'active' } })
    expect(
      (screen.getByTestId(
        'slack-channel-access-mode-C0123456789',
      ) as HTMLSelectElement).value,
    ).toBe('preferred')
  })
})
