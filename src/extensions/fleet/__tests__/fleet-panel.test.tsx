import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FleetPanel } from '../panels/fleet-panel'

// Use vitest's globalThis.fetch mocking pattern (matches MC fork's litellm
// usage-panel.test.tsx style — fetch is mocked per-test rather than via a
// global jest fetch shim).

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('<FleetPanel />', () => {
  it('renders agents from the API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          cluster: 'ender-stack-dev',
          region: 'us-east-1',
          services: [
            {
              name: 'ender-stack-dev-companion-openclaw-smoke-test',
              status: 'ACTIVE',
              desiredCount: 1,
              runningCount: 1,
              pendingCount: 0,
              taskDefinition: 'arn:...',
              launchType: 'FARGATE',
              activeDeployments: 1,
            },
          ],
          truncated: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ) as unknown as Response,
    )

    render(<FleetPanel />)

    await waitFor(() =>
      expect(
        screen.getByText('ender-stack-dev-companion-openclaw-smoke-test'),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
    expect(screen.getByText(/Cluster:/)).toBeInTheDocument()
    // Truncation banner only appears when truncated=true
    expect(screen.queryByTestId('truncation-banner')).not.toBeInTheDocument()
  })

  it('renders truncation warning when API reports truncated=true AND agents are present', async () => {
    // Truncation banner now agent-flavored — Fleet always-filters, so the
    // copy talks about "agents may be missing" not "services truncated".
    // Banner is only shown when services.length > 0; when there are zero
    // agents the empty-state copy carries the same warning, so showing
    // both would just duplicate the message.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          cluster: 'ender-stack-dev',
          region: 'us-east-1',
          services: [
            {
              name: 'ender-stack-dev-companion-openclaw-smoke-test',
              status: 'ACTIVE',
              desiredCount: 1,
              runningCount: 1,
              pendingCount: 0,
              taskDefinition: 'family:1',
              launchType: 'FARGATE',
              activeDeployments: 0,
            },
          ],
          truncated: true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ) as unknown as Response,
    )

    render(<FleetPanel />)

    const banner = await screen.findByTestId('truncation-banner')
    expect(banner.textContent).toMatch(/some agents may be missing/)
  })

  it('suppresses truncation banner when services=[] (empty-state copy carries the warning)', async () => {
    // Joint state truncated=true + services=[] — the empty-state alone is
    // sufficient. Banner would be redundant.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          cluster: 'ender-stack-dev',
          region: 'us-east-1',
          services: [],
          truncated: true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ) as unknown as Response,
    )

    render(<FleetPanel />)

    // Empty-state is shown
    const empty = await screen.findByTestId('empty-state')
    expect(empty.textContent).toMatch(/More services may exist beyond the page cap/)
    // Banner is suppressed
    expect(screen.queryByTestId('truncation-banner')).not.toBeInTheDocument()
  })

  it('renders agent-flavored empty-state when API returns zero agents', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          cluster: 'ender-stack-dev',
          region: 'us-east-1',
          services: [],
          truncated: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ) as unknown as Response,
    )

    render(<FleetPanel />)

    const empty = await screen.findByTestId('empty-state')
    expect(empty.textContent).toMatch(/No agents currently deployed/)
  })

  it('renders truncation-aware empty-state when truncated AND no agents', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          cluster: 'ender-stack-dev',
          region: 'us-east-1',
          services: [],
          truncated: true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ) as unknown as Response,
    )

    render(<FleetPanel />)

    const empty = await screen.findByTestId('empty-state')
    expect(empty.textContent).toMatch(
      /No agents found in the first 100 services\. More services may exist/,
    )
  })

  it('renders error state on 502 from API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'AccessDeniedException',
        }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      ) as unknown as Response,
    )

    render(<FleetPanel />)

    await waitFor(() =>
      expect(screen.getByText('Failed to load fleet')).toBeInTheDocument(),
    )
    expect(screen.getByText('AccessDeniedException')).toBeInTheDocument()
  })

  it('fetches /api/fleet/services without query params (no opt-in filter)', async () => {
    // Fleet's filter is always-on server-side — the panel never sends
    // `?harness=...`. Test guards against accidental reintroduction of
    // an opt-in toggle.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          cluster: 'ender-stack-dev',
          region: 'us-east-1',
          services: [],
          truncated: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ) as unknown as Response,
    )

    render(<FleetPanel />)

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/fleet/services')
    // No checkbox in the UI — the toggle was removed when the filter
    // moved to always-on.
    expect(screen.queryByLabelText(/Agent harnesses only/)).not.toBeInTheDocument()
  })

  it('renders the Refresh button in loading state on initial mount', async () => {
    // Hold fetch open so we can observe the initial-loading state.
    let resolveFetch: (resp: Response) => void = () => {}
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(fetchPromise)

    render(<FleetPanel />)

    // Loading text should be visible from t=0 because we initialize
    // useState(true) — not after useEffect fires.
    expect(screen.getByText(/Loading…/)).toBeInTheDocument()

    resolveFetch(
      new Response(
        JSON.stringify({
          cluster: 'ender-stack-dev',
          region: 'us-east-1',
          services: [],
          truncated: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await waitFor(() =>
      expect(screen.getByText(/Refresh/)).toBeInTheDocument(),
    )
  })
})

describe('<FleetPanel /> — Redeploy button', () => {
  // Helpers — the panel makes 1 fetch (services) on mount, then 1 fetch
  // (redeploy) on click, then 1 fetch (services again) to refresh post-rollout.
  // mockImplementation factory because Response body streams are single-use.
  const mkServicesResp = (services: unknown[] = [], truncated = false) =>
    new Response(
      JSON.stringify({
        cluster: 'ender-stack-dev',
        region: 'us-east-1',
        services,
        truncated,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )

  const stableSvc = {
    name: 'ender-stack-dev-companion-openclaw-smoke-test',
    status: 'ACTIVE',
    desiredCount: 1,
    runningCount: 1,
    pendingCount: 0,
    taskDefinition: 'family:1',
    launchType: 'FARGATE',
    activeDeployments: 0, // steady state — Redeploy enabled
  }

  it('POSTs to /api/fleet/services/:name/redeploy, refreshes table, and re-enables the button', async () => {
    // Auditor flagged: prior implementation set kind:'rolling' and never
    // reset, so the button stayed permanently disabled until hard reload.
    // This test simulates the operator-real flow: click → 202 → refresh
    // shows ECS already on a fresh task (activeDeployments=0) → button
    // back to enabled. The disable predicate now keys solely on
    // activeDeployments + the in-flight POST flag — ECS is the source of
    // truth for "rolling".
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = String(url)
      calls.push(u)
      if (u.endsWith('/redeploy')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              deploymentId: 'ecs-svc/new',
              taskDefinition: 'family:1',
            }),
            { status: 202, headers: { 'content-type': 'application/json' } },
          ),
        )
      }
      // /api/fleet/services — return steady-state data both before AND
      // after the redeploy click. In production, the post-redeploy fetch
      // would briefly show activeDeployments=1 then drop to 0 once ECS
      // reports COMPLETED. We collapse to "0 throughout" since the
      // disable predicate is the same shape either way and asserting
      // re-enabled is the regression we care about.
      return Promise.resolve(mkServicesResp([stableSvc]))
    })

    render(<FleetPanel />)

    const button = await screen.findByTestId(`redeploy-${stableSvc.name}`)
    expect(button).toBeEnabled()

    await act(async () => {
      ;(button as HTMLButtonElement).click()
    })

    // Right URL was POSTed
    await waitFor(() =>
      expect(
        calls.some((c) =>
          c.endsWith(`/api/fleet/services/${stableSvc.name}/redeploy`),
        ),
      ).toBe(true),
    )
    // Table refresh fetch followed
    await waitFor(() =>
      expect(calls.filter((c) => c === '/api/fleet/services').length).toBeGreaterThanOrEqual(2),
    )
    // Button re-enabled after the refresh — regression guard for the
    // 'rolling' state bug Auditor flagged on the initial commit.
    await waitFor(() =>
      expect(screen.getByTestId(`redeploy-${stableSvc.name}`)).toBeEnabled(),
    )
  })

  it('renders an inline error if the redeploy POST returns 502', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = String(url)
      if (u.endsWith('/redeploy')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: 'AccessDeniedException' }),
            { status: 502, headers: { 'content-type': 'application/json' } },
          ),
        )
      }
      return Promise.resolve(mkServicesResp([stableSvc]))
    })

    render(<FleetPanel />)
    const button = await screen.findByTestId(`redeploy-${stableSvc.name}`)
    await act(async () => {
      ;(button as HTMLButtonElement).click()
    })

    const errorEl = await screen.findByTestId(
      `redeploy-error-${stableSvc.name}`,
    )
    expect(errorEl.textContent).toMatch(/AccessDeniedException/)
  })

  it('disables Redeploy button when activeDeployments > 0 (avoids double-rolling)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        mkServicesResp([{ ...stableSvc, activeDeployments: 1 }]),
      ),
    )

    render(<FleetPanel />)
    const button = await screen.findByTestId(`redeploy-${stableSvc.name}`)
    expect(button).toBeDisabled()
    // Button label flips to "Rolling…" when ECS already shows IN_PROGRESS
    expect(button.textContent).toMatch(/Rolling/)
  })
})

describe('<FleetPanel /> — auto-poll while rolling', () => {
  // Defensive teardown — guarantees fake timers don't leak to the next
  // test if an assertion throws before the in-test useRealTimers() runs.
  // beforeEach's restoreAllMocks doesn't touch timer state.
  afterEach(() => {
    vi.useRealTimers()
  })

  // ECS rollouts take 2–4 min; without polling, the Fleet panel snapshots
  // the post-Redeploy IN_PROGRESS state and never refreshes — operator
  // sees "Rolling…" indefinitely until they click Refresh manually. These
  // tests pin the contract: poll while any row has activeDeployments > 0,
  // stop the moment all rows are steady.

  const rollingSvc = {
    name: 'ender-stack-dev-companion-openclaw-smoke-test',
    status: 'ACTIVE',
    desiredCount: 1,
    runningCount: 0,
    pendingCount: 1,
    taskDefinition: 'family:1',
    launchType: 'FARGATE',
    activeDeployments: 1, // mid-rollout
  }

  const steadySvc = {
    ...rollingSvc,
    runningCount: 1,
    pendingCount: 0,
    activeDeployments: 0,
  }

  const mkResp = (services: unknown[]) =>
    new Response(
      JSON.stringify({
        cluster: 'ender-stack-dev',
        region: 'us-east-1',
        services,
        truncated: false,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )

  it('polls /api/fleet/services every 5s while a row has activeDeployments > 0', async () => {
    // Scope fake timers to setInterval/clearInterval only — leaving
    // setTimeout real lets waitFor's internal poll loop continue working.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(mkResp([rollingSvc])))

    render(<FleetPanel />)

    // Flush the initial mount fetch
    await vi.runOnlyPendingTimersAsync()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const initialCalls = fetchSpy.mock.calls.length

    // Advance 5s — first poll should fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(fetchSpy.mock.calls.length).toBe(initialCalls + 1)

    // Advance another 5s — second poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(fetchSpy.mock.calls.length).toBe(initialCalls + 2)

  })

  it('stops polling once all rows reach activeDeployments=0', async () => {
    // Scope fake timers to setInterval/clearInterval only — leaving
    // setTimeout real lets waitFor's internal poll loop continue working.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })

    let respServices: unknown[] = [rollingSvc]
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(mkResp(respServices)))

    render(<FleetPanel />)
    await vi.runOnlyPendingTimersAsync()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())

    // Flip backend to steady-state
    respServices = [steadySvc]

    // Tick once — poll fetches steady-state, panel sees no rolling rows,
    // useEffect cleanup clears the interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    const callsAfterSteady = fetchSpy.mock.calls.length

    // Advance another 30s — no further polls should fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000)
    })
    expect(fetchSpy.mock.calls.length).toBe(callsAfterSteady)

  })

  it('does not start polling on initial steady-state mount', async () => {
    // Scope fake timers to setInterval/clearInterval only — leaving
    // setTimeout real lets waitFor's internal poll loop continue working.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(mkResp([steadySvc])))

    render(<FleetPanel />)
    await vi.runOnlyPendingTimersAsync()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const initialCalls = fetchSpy.mock.calls.length

    // Advance well past one poll interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000)
    })
    // No polls fired — initial fetch only
    expect(fetchSpy.mock.calls.length).toBe(initialCalls)

  })

  it('keeps polling through transient errors (does not flip hasRolling false on 502)', async () => {
    // Auditor #34 flagged: clearing data on a non-2xx response makes
    // hasRolling evaluate to false → useEffect cleanup → interval
    // cleared → operator stranded on "Rolling…" until manual Refresh.
    // The exact UX bug this PR sets out to fix would re-emerge on any
    // transient AWS hiccup mid-rollout. Test asserts data survives a
    // mid-rollout 502 and polling keeps firing.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })

    let respMode: 'ok' | 'error' = 'ok'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      respMode === 'ok'
        ? Promise.resolve(mkResp([rollingSvc]))
        : Promise.resolve(
            new Response(JSON.stringify({ error: 'AccessDeniedException' }), {
              status: 502,
              headers: { 'content-type': 'application/json' },
            }),
          ),
    )

    render(<FleetPanel />)
    await vi.runOnlyPendingTimersAsync()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())

    // Flip backend to 502 — simulating a transient AWS hiccup mid-rollout
    respMode = 'error'

    // First poll fires and gets the 502 — but data should survive
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    // Critical assertion: polling continues. If the panel had cleared data
    // on the 502, hasRolling would be false and the interval would have
    // been cleared — no further fetches.
    const callsAfterFirstPoll = fetchSpy.mock.calls.length

    // Backend recovers
    respMode = 'ok'

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    // Second poll fired — proves the interval survived the 502
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirstPoll)
  })

  it('background polls do not toggle the loading flag (no Refresh button flicker)', async () => {
    // Auditor #34 flagged: load() unconditionally sets loading=true,
    // making the Refresh button briefly disabled + showing "Loading…"
    // every 5s during a rollout the operator didn't initiate. Background
    // polls now pass silent=true and skip the loading state.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })

    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(mkResp([rollingSvc])),
    )

    render(<FleetPanel />)
    await vi.runOnlyPendingTimersAsync()
    // Wait for initial load to settle (button shows "Refresh" not "Loading…")
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument(),
    )

    // Capture the button label before + immediately after a poll tick.
    // If load() were toggling `loading` during the silent poll, this
    // assertion would catch the brief "Loading…" flip via the React
    // render cycle.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Loading…/i })).not.toBeInTheDocument()
  })
})

describe('<FleetPanel /> — AbortController + staleness indicator', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const stableSvc = {
    name: 'ender-stack-dev-companion-openclaw-smoke-test',
    status: 'ACTIVE',
    desiredCount: 1,
    runningCount: 1,
    pendingCount: 0,
    taskDefinition: 'family:1',
    launchType: 'FARGATE',
    activeDeployments: 0,
  }

  const mkResp = (services: unknown[]) =>
    new Response(
      JSON.stringify({
        cluster: 'ender-stack-dev',
        region: 'us-east-1',
        services,
        truncated: false,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )

  it('passes signal to fetch (AbortController is wired up)', async () => {
    // Lightweight assertion: every fetch call carries an AbortSignal.
    // Lets future maintainers see the contract without depending on
    // race-condition test plumbing.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mkResp([stableSvc]) as unknown as Response)

    render(<FleetPanel />)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())

    const init = fetchSpy.mock.calls[0][1] as RequestInit | undefined
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('aborts in-flight fetch on component unmount', async () => {
    let abortFired = false
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal
      signal?.addEventListener('abort', () => {
        abortFired = true
      })
      // Never resolves — simulates a slow/hung fetch
      return new Promise<Response>(() => {})
    })

    const { unmount } = render(<FleetPanel />)
    // Unmount mid-fetch
    unmount()

    expect(abortFired).toBe(true)
  })

  it('renders staleness indicator when error AND data are both present', async () => {
    // Initial load succeeds; second fetch (e.g. auto-poll or manual
    // Refresh) returns 502. Data is preserved; error banner renders;
    // staleness indicator should appear next to the cluster summary
    // showing how long ago the table data was fetched.
    let respMode: 'ok' | 'error' = 'ok'
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      respMode === 'ok'
        ? Promise.resolve(mkResp([stableSvc]))
        : Promise.resolve(
            new Response(JSON.stringify({ error: 'AccessDeniedException' }), {
              status: 502,
              headers: { 'content-type': 'application/json' },
            }),
          ),
    )

    render(<FleetPanel />)

    // Wait for initial load to populate data — no staleness indicator
    // yet (no error).
    await screen.findByText('ender-stack-dev-companion-openclaw-smoke-test')
    expect(screen.queryByTestId('staleness-indicator')).not.toBeInTheDocument()

    // Trigger a 502 via the Refresh button
    respMode = 'error'
    const button = screen.getByRole('button', { name: /Refresh/i })
    await act(async () => {
      ;(button as HTMLButtonElement).click()
    })

    // Error banner renders + staleness indicator appears
    await screen.findByText('Failed to load fleet')
    const indicator = await screen.findByTestId('staleness-indicator')
    expect(indicator.textContent).toMatch(/Last refreshed: \d+s ago/)
  })

  it('a silent poll superseding a non-silent Refresh does NOT leave loading stuck', async () => {
    // Real regression test for the Auditor PR #35 stuck-state bug.
    // Sequence:
    //   1. Mount → first fetch resolves → loading=false, Refresh visible
    //   2. Click Refresh → second fetch hangs → loading=true
    //   3. Silent poll fires → aborts second → poll's fetch resolves
    //      → loading MUST flip back to false
    //
    // Earlier guard `!silent && !controller.signal.aborted` prevented
    // the aborted Refresh from clearing loading AND prevented the
    // silent poll from clearing it (because !silent was false), so
    // loading stayed true forever. Fix: canonical-call check via
    // `abortRef.current === controller`, no silent gate.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })

    let resolveRefreshFetch: (r: Response) => void = () => {}

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() =>
        // Mount fetch — rolling state so the auto-poll engages
        Promise.resolve(
          mkResp([{ ...stableSvc, activeDeployments: 1 }]) as unknown as Response,
        ),
      )
      .mockImplementationOnce(
        () =>
          // Refresh fetch — hangs until manually resolved (or aborted)
          new Promise<Response>((resolve) => {
            resolveRefreshFetch = resolve
          }),
      )
      .mockImplementation(() =>
        // Subsequent polls — return steady state
        Promise.resolve(mkResp([stableSvc]) as unknown as Response),
      )

    render(<FleetPanel />)

    // Wait for mount load to settle + the Refresh button to appear
    await screen.findByRole('button', { name: /Refresh/i })

    // Click Refresh → fetch #2 starts, hangs, loading=true
    const refreshBtn = screen.getByRole('button', { name: /Refresh/i })
    await act(async () => {
      ;(refreshBtn as HTMLButtonElement).click()
    })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Loading…/i }),
      ).toBeInTheDocument(),
    )

    // Advance 5s → auto-poll fires (silent), aborts the hung Refresh,
    // its own fetch resolves with steady state.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    // Resolve the now-aborted Refresh fetch (in production the
    // browser's fetch rejects with AbortError; under jsdom we just
    // close the dangling promise; the panel's catch already saw the
    // signal abort).
    resolveRefreshFetch(mkResp([stableSvc]) as unknown as Response)

    // Critical assertion: button is back to "Refresh" — NOT stuck on
    // "Loading…". The silent poll, as the canonical call, took over
    // setLoading responsibility.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Refresh/i }),
      ).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('button', { name: /Loading…/i }),
    ).not.toBeInTheDocument()
    void fetchSpy
  })

  it('hides staleness indicator when no error is present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mkResp([stableSvc]) as unknown as Response,
    )

    render(<FleetPanel />)
    await screen.findByText('ender-stack-dev-companion-openclaw-smoke-test')

    // No error → no staleness indicator, even though we DO have data
    expect(screen.queryByTestId('staleness-indicator')).not.toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Phase 2.2 Beat 3b — create-agent toggle + parent-child contract
//
// The form itself is unit-tested in create-agent-form.test.tsx. These tests
// cover the wiring between the panel and the form: that the toggle button
// opens/closes the form, that onClose dismisses it, and that onCreated
// triggers a refresh of the services table. Round-2 audit recommendation —
// without these, mis-wiring `setCreateOpen` to the wrong callback would
// silently ship.
// ──────────────────────────────────────────────────────────────────────────────

describe('<FleetPanel /> — create-agent toggle', () => {
  function mkServicesResp(services: object[] = []) {
    return new Response(
      JSON.stringify({
        cluster: 'ender-stack-dev',
        region: 'us-east-1',
        services,
        truncated: false,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  // URL-routing fetch mock: handles the existing /api/fleet/services
  // baseline + the form's /api/fleet/harness-defaults fetch on open
  // + an optional POST response for the create-agent flow. Beat 3b.1
  // moved from queue-based mocks to URL-routing because the form's
  // mount-time harness-defaults useEffect made order-dependent
  // queues fragile.
  function mockFetchRoutes(opts: {
    services: () => Response
    post?: Response
    defaultImage?: string | null
  }) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : (input as URL | Request).toString()
      if (url.includes('/api/fleet/services')) {
        return opts.services() as unknown as Response
      }
      if (url.includes('/api/fleet/harness-defaults')) {
        return new Response(
          JSON.stringify({
            defaults: {
              'companion/openclaw': { defaultImage: opts.defaultImage ?? null },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ) as unknown as Response
      }
      if (url.includes('/api/fleet/agents') && init?.method === 'POST') {
        if (!opts.post) throw new Error('No POST mock provided')
        return opts.post
      }
      throw new Error(`Unmocked fetch URL: ${url}`)
    })
  }

  it('"Create agent" button opens the modal; Cancel closes it', async () => {
    mockFetchRoutes({ services: () => mkServicesResp() })
    render(<FleetPanel />)

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /Loading…/i }),
      ).not.toBeInTheDocument()
    })

    expect(screen.queryByTestId('create-agent-modal')).not.toBeInTheDocument()

    const toggle = screen.getByTestId('toggle-create-agent')
    expect(toggle).toHaveTextContent('Create agent')

    fireEvent.click(toggle)
    expect(screen.getByTestId('create-agent-modal')).toBeInTheDocument()
    // Single-action button: label stays "Create agent" — modal has
    // its own Esc / backdrop / Cancel close paths.
    expect(toggle).toHaveTextContent('Create agent')

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(screen.queryByTestId('create-agent-modal')).not.toBeInTheDocument()
  })

  it('successful create triggers a refresh on the services table (onCreated → load())', async () => {
    // Expected fetch sequence:
    //   1. initial GET /api/fleet/services (panel mount)
    //   2. GET /api/fleet/harness-defaults (form mount-effect on open)
    //   3. POST /api/fleet/agents (form submit, returns 201)
    //   4. GET /api/fleet/services (refresh, triggered by onCreated)
    let servicesCallCount = 0
    const fetchSpy = mockFetchRoutes({
      services: () => {
        servicesCallCount += 1
        // First call: empty fleet. Second call: shows new agent.
        return servicesCallCount === 1
          ? mkServicesResp()
          : mkServicesResp([
              {
                name: 'ender-stack-dev-companion-openclaw-smoke-2',
                status: 'ACTIVE',
                desiredCount: 1,
                runningCount: 0,
                pendingCount: 1,
                taskDefinition: 'family:1',
                launchType: 'FARGATE',
                activeDeployments: 1,
              },
            ])
      },
      post: new Response(
        JSON.stringify({
          ok: true,
          agentName: 'smoke-2',
          resources: {
            serviceArn: 'arn:s',
            taskDefinitionArn: 'arn:t',
            targetGroupArn: 'arn:tg',
            listenerRuleArn: 'arn:lr',
            logGroup: '/ecs/lg',
            listenerPath: '/agent/smoke-2',
          },
          warnings: [],
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ) as unknown as Response,
    })

    render(<FleetPanel />)

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /Loading…/i }),
      ).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('toggle-create-agent'))

    fireEvent.change(screen.getByLabelText(/Agent name/i), {
      target: { value: 'smoke-2' },
    })
    fireEvent.change(screen.getByLabelText(/Container image/i), {
      target: { value: 'ghcr.io/stroupaloop/openclaw:sha-abc1234' },
    })
    fireEvent.change(screen.getByLabelText(/Role description/i), {
      target: { value: 'integration test' },
    })
    // #376: archetype + owner fields became required in PR C.
    fireEvent.change(screen.getByLabelText(/Role archetype/i), {
      target: { value: 'software-engineer' },
    })
    fireEvent.change(screen.getByLabelText(/Owner name/i), {
      target: { value: 'Andrew Stroup' },
    })
    fireEvent.change(screen.getByLabelText(/Owner Slack ID/i), {
      target: { value: 'U01ABCDEF23' },
    })

    // Toggle button + form submit button both read "Create agent"
    // now that the toggle is single-action (Beat 3b.1) — use the
    // form's `type=submit` to disambiguate.
    const submit = screen
      .getByTestId('create-agent-form')
      .querySelector('button[type="submit"]')
    if (!submit) throw new Error('form submit button not found')
    fireEvent.click(submit)

    await screen.findByTestId('create-agent-success')
    await screen.findByText('ender-stack-dev-companion-openclaw-smoke-2')

    // Verify the URL+method sequence — proves onCreated() fired the
    // refresh GET.
    const urls = fetchSpy.mock.calls.map((c) => {
      const [url, init] = c as [string | URL | Request, RequestInit?]
      const u = typeof url === 'string' ? url : (url as URL).toString()
      return { url: u, method: init?.method ?? 'GET' }
    })
    // Two services GETs (initial + post-create refresh).
    const servicesGets = urls.filter(
      (u) => u.url === '/api/fleet/services' && u.method === 'GET',
    )
    expect(servicesGets.length).toBe(2)
    // One agents POST.
    const agentsPosts = urls.filter(
      (u) => u.url === '/api/fleet/agents' && u.method === 'POST',
    )
    expect(agentsPosts.length).toBe(1)
  })

  it('clicking an MC-managed agent name opens the detail panel', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation(async (url) => {
      const u =
        typeof url === 'string' ? url : (url as URL | Request).toString()
      if (u.endsWith('/api/fleet/services')) {
        return new Response(
          JSON.stringify({
            cluster: 'ender-stack-dev',
            region: 'us-east-1',
            services: [
              {
                name: 'ender-stack-dev-companion-openclaw-hello-bot',
                status: 'ACTIVE',
                desiredCount: 1,
                runningCount: 1,
                pendingCount: 0,
                taskDefinition: 'fam:5',
                launchType: 'FARGATE',
                activeDeployments: 0,
              },
            ],
            truncated: false,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ) as unknown as Response
      }
      if (u.includes('/slack/manifest')) {
        return new Response(
          JSON.stringify({
            ok: true,
            agentName: 'hello-bot',
            manifest: { display_information: { name: 'mc-agent-hello-bot' } },
            instructions: ['step 1', 'step 2'],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ) as unknown as Response
      }
      return new Response('not found', { status: 404 }) as unknown as Response
    })

    render(<FleetPanel />)
    const detailBtn = await screen.findByTestId(
      'detail-ender-stack-dev-companion-openclaw-hello-bot',
    )
    // Pre-click: panel not in DOM
    expect(
      document.body.querySelector('[data-testid="agent-detail-panel"]'),
    ).toBeNull()
    fireEvent.click(detailBtn)
    // Post-click: panel renders into document.body via createPortal
    await waitFor(() =>
      expect(
        document.body.querySelector('[data-testid="agent-detail-panel"]'),
      ).not.toBeNull(),
    )
  })

  it('renders a non-agent service name as plain text (no detail button)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          cluster: 'ender-stack-dev',
          region: 'us-east-1',
          services: [
            {
              // Not MC-managed (doesn't match
              // -companion-openclaw-{name} suffix).
              name: 'ender-stack-dev-litellm',
              status: 'ACTIVE',
              desiredCount: 1,
              runningCount: 1,
              pendingCount: 0,
              taskDefinition: 'fam:1',
              launchType: 'FARGATE',
              activeDeployments: 0,
            },
          ],
          truncated: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ) as unknown as Response,
    )

    render(<FleetPanel />)
    await waitFor(() =>
      expect(
        screen.getByText('ender-stack-dev-litellm'),
      ).toBeInTheDocument(),
    )
    // No detail button; the service-name cell is plain text.
    expect(
      screen.queryByTestId('detail-ender-stack-dev-litellm'),
    ).not.toBeInTheDocument()
  })
})
