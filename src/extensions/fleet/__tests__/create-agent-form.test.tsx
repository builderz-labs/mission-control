import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateAgentForm } from '../panels/create-agent-form'

beforeEach(() => {
  vi.restoreAllMocks()
})

const validInputs = {
  agentName: 'smoke-2',
  image: 'ghcr.io/stroupaloop/openclaw:sha-abc1234',
  roleDescription: 'Phase 2.2 vertical-slice smoke test',
}

function fill(inputs: Partial<typeof validInputs> = {}) {
  const merged = { ...validInputs, ...inputs }
  fireEvent.change(screen.getByLabelText(/Agent name/i), {
    target: { value: merged.agentName },
  })
  fireEvent.change(screen.getByLabelText(/Container image/i), {
    target: { value: merged.image },
  })
  fireEvent.change(screen.getByLabelText(/Role description/i), {
    target: { value: merged.roleDescription },
  })
}

/**
 * Beat 3b.1 — the form now fetches `/api/fleet/harness-defaults` on
 * open in a useEffect. Tests need to route fetches by URL rather
 * than queueing single responses, otherwise the harness-defaults
 * fetch consumes the test's intended POST mock.
 *
 * Pass `post` for the agents response (optional — leave undefined for
 * tests that don't submit). Pass `defaultImage` to set what
 * harness-defaults returns (default null = "no pre-fill").
 */
function mockFetch(opts: {
  post?: Response
  postReject?: Error
  defaultImage?: string | null
  agentNameMaxLength?: number
}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string' ? input : (input as URL | Request).toString()
    if (url.includes('/api/fleet/harness-defaults')) {
      return new Response(
        JSON.stringify({
          defaults: {
            'companion/openclaw': {
              defaultImage: opts.defaultImage ?? null,
              agentNameMaxLength: opts.agentNameMaxLength ?? 32,
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ) as unknown as Response
    }
    if (url.includes('/api/fleet/agents') && init?.method === 'POST') {
      if (opts.postReject) throw opts.postReject
      if (!opts.post) throw new Error('No POST mock provided')
      return opts.post
    }
    throw new Error(`Unmocked fetch URL: ${url}`)
  })
}

describe('<CreateAgentForm />', () => {
  it('disables Create until all fields are valid', () => {
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    const submit = screen.getByRole('button', { name: /Create agent/i })
    expect(submit).toBeDisabled()
    fill()
    expect(submit).not.toBeDisabled()
  })

  it('rejects an agent name with a leading hyphen at the client layer', () => {
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    fill({ agentName: '-bad' })
    expect(
      screen.getByRole('button', { name: /Create agent/i }),
    ).toBeDisabled()
  })

  it('rejects an agent name with a trailing hyphen at the client layer', () => {
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    fill({ agentName: 'bad-' })
    expect(
      screen.getByRole('button', { name: /Create agent/i }),
    ).toBeDisabled()
  })

  it('rejects an image without a tag separator at the client layer', () => {
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    fill({ image: 'ghcr.io/stroupaloop/openclaw' })
    expect(
      screen.getByRole('button', { name: /Create agent/i }),
    ).toBeDisabled()
  })

  it('rejects an image with a separator but empty tag (e.g. `img:`)', () => {
    // Round-8 audit: `image.includes(':')` would have accepted `img:`,
    // which then 502s at AWS-side InvalidParameterException. Catching
    // it client-side gives immediate operator feedback.
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    fill({ image: 'ghcr.io/stroupaloop/openclaw:' })
    expect(
      screen.getByRole('button', { name: /Create agent/i }),
    ).toBeDisabled()
  })

  it('rejects a whitespace-only role description at the client layer', () => {
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    fill({ roleDescription: '    ' })
    expect(
      screen.getByRole('button', { name: /Create agent/i }),
    ).toBeDisabled()
  })

  // #357 Phase-2: optional persona fields (displayName / emoji /
  // persona). These satisfy CLAUDE.md's test-discipline hard rule for
  // the form layer; the template-level + handler-level coverage lives
  // in templates-openclaw.test.ts + agents-create.test.ts. Claude bot
  // R2 high finding on PR #69.
  it('#357 Phase-2: renders displayName / emoji / persona inputs and accepts input', () => {
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    const displayName = screen.getByLabelText(/^Display name$/i) as HTMLInputElement
    const emoji = screen.getByLabelText(/^Emoji$/i) as HTMLInputElement
    const persona = screen.getByLabelText(/^Persona$/i) as HTMLTextAreaElement
    fireEvent.change(displayName, { target: { value: 'Aria' } })
    fireEvent.change(emoji, { target: { value: '🦊' } })
    fireEvent.change(persona, { target: { value: 'Direct, opinionated.' } })
    expect(displayName.value).toBe('Aria')
    expect(emoji.value).toBe('🦊')
    expect(persona.value).toBe('Direct, opinionated.')
  })

  it('#357 Phase-2: persona fields default empty → POST body omits them', async () => {
    const postResponse = new Response(
      JSON.stringify({
        ok: true,
        agentName: 'smoke-2',
        resources: {
          serviceArn: 'arn:test', taskDefinitionArn: 'arn:test',
          targetGroupArn: 'arn:test', listenerRuleArn: 'arn:test',
          logGroup: '/test', listenerPath: '/agent/smoke-2',
        },
        warnings: [],
      }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    )
    const fetchMock = mockFetch({ post: postResponse })
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: /Create agent/i }))
    await waitFor(() =>
      expect(screen.getByTestId('create-agent-success')).toBeInTheDocument(),
    )
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url === '/api/fleet/agents' &&
        init?.method === 'POST',
    )
    const body = JSON.parse((postCall?.[1]?.body as string) ?? '{}') as Record<string, unknown>
    // Optional fields must NOT appear in the body when empty (the
    // template's conditional emission expects undefined, not '').
    expect(body).not.toHaveProperty('displayName')
    expect(body).not.toHaveProperty('emoji')
    expect(body).not.toHaveProperty('persona')
  })

  it('#357 Phase-2: persona fields populated → POST body includes them verbatim', async () => {
    const postResponse = new Response(
      JSON.stringify({
        ok: true,
        agentName: 'smoke-2',
        resources: {
          serviceArn: 'arn:test', taskDefinitionArn: 'arn:test',
          targetGroupArn: 'arn:test', listenerRuleArn: 'arn:test',
          logGroup: '/test', listenerPath: '/agent/smoke-2',
        },
        warnings: [],
      }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    )
    const fetchMock = mockFetch({ post: postResponse })
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    fill()
    fireEvent.change(screen.getByLabelText(/^Display name$/i), {
      target: { value: 'Aria' },
    })
    fireEvent.change(screen.getByLabelText(/^Emoji$/i), {
      target: { value: '🦊' },
    })
    fireEvent.change(screen.getByLabelText(/^Persona$/i), {
      target: { value: 'Direct, opinionated. Skip filler.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Create agent/i }))
    await waitFor(() =>
      expect(screen.getByTestId('create-agent-success')).toBeInTheDocument(),
    )
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url === '/api/fleet/agents' &&
        init?.method === 'POST',
    )
    const body = JSON.parse((postCall?.[1]?.body as string) ?? '{}') as Record<string, unknown>
    expect(body.displayName).toBe('Aria')
    expect(body.emoji).toBe('🦊')
    expect(body.persona).toBe('Direct, opinionated. Skip filler.')
  })

  it('#357 Phase-2: persona-field overflow (UTF-8 bytes) blocks submit', () => {
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    fill()
    const submit = screen.getByRole('button', { name: /Create agent/i })
    expect(submit).not.toBeDisabled() // baseline passes with required fields
    // 33 fox emojis = 33 UTF-16 code units = 132 UTF-8 bytes (> 64 cap).
    // Pre-fix this would have passed the form's UTF-16 .length check.
    fireEvent.change(screen.getByLabelText(/^Display name$/i), {
      target: { value: '🦊'.repeat(33) },
    })
    expect(submit).toBeDisabled()
  })

  it('POSTs the expected JSON body and surfaces success state with warnings', async () => {
    // Fixture uses a fictional warning code (`fixture-warning`) so this
    // test exercises the warnings-array rendering contract independent
    // of any specific real warning. The handler currently emits an
    // empty warnings array; using a fictional code here keeps the test
    // honest about what it covers — rendering, not any specific
    // real warning that may come and go over time.
    const fetchMock = mockFetch({
      post: new Response(
        JSON.stringify({
          ok: true,
          agentName: 'smoke-2',
          resources: {
            serviceArn: 'arn:aws:ecs:us-east-1:1:service/c/s',
            taskDefinitionArn: 'arn:aws:ecs:us-east-1:1:task-definition/t:1',
            targetGroupArn:
              'arn:aws:elasticloadbalancing:us-east-1:1:targetgroup/tg/abc',
            listenerRuleArn:
              'arn:aws:elasticloadbalancing:us-east-1:1:listener-rule/app/lb/abc/lst/rule',
            logGroup: '/ecs/c/companion-openclaw-smoke-2',
            listenerPath: '/agent/smoke-2 (+ /agent/smoke-2/*)',
          },
          warnings: [
            {
              code: 'fixture-warning',
              message:
                'Fictional warning used by this test fixture — proves the warnings array renders.',
            },
          ],
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ) as unknown as Response,
    })

    const onCreated = vi.fn()
    render(<CreateAgentForm open={true} onCreated={onCreated} onClose={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: /Create agent/i }))

    await waitFor(() =>
      expect(screen.getByTestId('create-agent-success')).toBeInTheDocument(),
    )
    expect(onCreated).toHaveBeenCalledTimes(1)

    // POST body shape — handler treats agentName regex as a security
    // control; double-check the form actually emits the user's input.
    // Form fetches /api/fleet/harness-defaults first (mount useEffect)
    // then POSTs to /api/fleet/agents — find the POST call by URL.
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url === '/api/fleet/agents' &&
        init?.method === 'POST',
    )
    expect(postCall).toBeDefined()
    const body = JSON.parse(
      (postCall?.[1]?.body as string) ?? '{}',
    ) as Record<string, unknown>
    expect(body).toEqual({
      harnessType: 'companion/openclaw',
      agentName: 'smoke-2',
      image: 'ghcr.io/stroupaloop/openclaw:sha-abc1234',
      roleDescription: 'Phase 2.2 vertical-slice smoke test',
    })

    // Warning code surfaced verbatim — Beat 3a uses stable codes
    // specifically so the UI can render specific guidance without
    // parsing message text.
    expect(screen.getByTestId('create-agent-warnings')).toHaveTextContent(
      'fixture-warning',
    )
  })

  it('renders an error block (with status + SDK error name) on a 502', async () => {
    mockFetch({
      post: new Response(
        JSON.stringify({
          error: 'ServerException',
          partialResources: {
            taskDefinitionArn:
              'arn:aws:ecs:us-east-1:1:task-definition/t:1',
            logGroup: '/ecs/c/companion-openclaw-smoke-2',
          },
        }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      ) as unknown as Response,
    })

    const onCreated = vi.fn()
    render(<CreateAgentForm open={true} onCreated={onCreated} onClose={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: /Create agent/i }))

    await waitFor(() =>
      expect(screen.getByTestId('create-agent-error')).toBeInTheDocument(),
    )
    expect(onCreated).not.toHaveBeenCalled()

    const errBox = screen.getByTestId('create-agent-error')
    expect(errBox).toHaveTextContent('502')
    expect(errBox).toHaveTextContent('ServerException')
    // Operator needs to know what to clean up — partialResources MUST
    // surface in the error block.
    expect(errBox).toHaveTextContent('task-definition/t:1')
    expect(errBox).toHaveTextContent('/ecs/c/companion-openclaw-smoke-2')
  })

  it('surfaces a "serviceArn unknown" warning in the cleanup list when partialResources.serviceArn is null (round-5 audit)', async () => {
    // Backend sets partial.serviceArn = null when CreateService
    // returns no ARN — see agents-create.test.ts. The form must
    // render guidance to the operator since a running ECS service
    // with no known ARN is the most expensive orphan to leave behind.
    mockFetch({
      post: new Response(
        JSON.stringify({
          error: 'Error',
          partialResources: {
            taskDefinitionArn:
              'arn:aws:ecs:us-east-1:1:task-definition/t:1',
            targetGroupArn:
              'arn:aws:elasticloadbalancing:us-east-1:1:targetgroup/tg/abc',
            listenerRuleArn:
              'arn:aws:elasticloadbalancing:us-east-1:1:listener-rule/app/lb/abc/lst/rule',
            logGroup: '/ecs/c/companion-openclaw-smoke-2',
            serviceArn: null,
          },
        }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      ) as unknown as Response,
    })

    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: /Create agent/i }))

    await waitFor(() =>
      expect(screen.getByTestId('create-agent-error')).toBeInTheDocument(),
    )

    const warning = screen.getByTestId('partial-service-arn-warning')
    expect(warning).toBeInTheDocument()
    expect(warning).toHaveTextContent(/Service ARN unknown/)
    expect(warning).toHaveTextContent(/aws ecs describe-services/)
    // Operator-actionable: still shows the four resolvable ARNs above
    // the unknown-ARN warning so cleanup proceeds in order.
    const errBox = screen.getByTestId('create-agent-error')
    expect(errBox).toHaveTextContent('task-definition/t:1')
  })

  it('preserves the HTTP status when the response body is not valid JSON (502 with HTML proxy body)', async () => {
    // Round-6 audit caught: a proxy returning HTML on a gateway error
    // would have surfaced as "0 — SyntaxError" instead of the actual
    // "502 — ResponseParseError". Operator misdiagnoses a real
    // failure mode if the status doesn't survive the JSON parse.
    mockFetch({
      post: new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }) as unknown as Response,
    })

    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: /Create agent/i }))

    await waitFor(() =>
      expect(screen.getByTestId('create-agent-error')).toBeInTheDocument(),
    )
    const errBox = screen.getByTestId('create-agent-error')
    // The status (502) must surface — pre-fix this would have been "0".
    expect(errBox).toHaveTextContent('502')
    // ResponseParseError marks "got a Response, couldn't parse it" —
    // distinct from a network failure (status=0).
    expect(errBox).toHaveTextContent('ResponseParseError')
  })

  it('surfaces SubmitTimeout when fetch is aborted by the timeout guard', async () => {
    // Round-6 audit caught: AWS calls fan out across ≥6 sequential
    // SDK calls; a degraded service would leave the form stuck
    // "Creating…" indefinitely. AbortController fires SubmitTimeout
    // (not generic NetworkError) so operators distinguish hard
    // timeouts from transient network glitches.
    mockFetch({
      postReject: Object.assign(new Error('aborted'), { name: 'AbortError' }),
    })

    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: /Create agent/i }))

    await waitFor(() =>
      expect(screen.getByTestId('create-agent-error')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('create-agent-error')).toHaveTextContent(
      'SubmitTimeout',
    )
  })

  it('renders an error block with a "0 — NetworkError" code on fetch reject', async () => {
    mockFetch({
      postReject: Object.assign(new Error('boom'), { name: 'TypeError' }),
    })

    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: /Create agent/i }))

    await waitFor(() =>
      expect(screen.getByTestId('create-agent-error')).toBeInTheDocument(),
    )
    // Status 0 prefix is suppressed in the displayed string; we only
    // surface the SDK-style error name.
    const errBox = screen.getByTestId('create-agent-error')
    expect(errBox).toHaveTextContent('TypeError')
  })

  it('calls onClose when the operator cancels', () => {
    const onClose = vi.fn()
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('"Create another" resets the form to the idle state with empty fields', async () => {
    mockFetch({
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

    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: /Create agent/i }))

    await waitFor(() =>
      expect(screen.getByTestId('create-agent-success')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: /Create another/i }))

    // After reset: success view is gone, form fields are empty,
    // submit is disabled (no fields filled). Defends against reset()
    // accidentally dropping any default state.
    expect(screen.queryByTestId('create-agent-success')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Agent name/i)).toHaveValue('')
    expect(screen.getByLabelText(/Container image/i)).toHaveValue('')
    expect(screen.getByLabelText(/Role description/i)).toHaveValue('')
    expect(
      screen.getByRole('button', { name: /Create agent/i }),
    ).toBeDisabled()
  })

  // ── Beat 3b.1: modal behavior + image pre-fill + digit-start regex ──

  it('does not render anything when `open` is false', () => {
    mockFetch({})
    const { container } = render(
      <CreateAgentForm open={false} onCreated={vi.fn()} onClose={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('create-agent-modal')).not.toBeInTheDocument()
  })

  it('renders as a portaled modal with backdrop when `open` is true', () => {
    mockFetch({})
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByTestId('create-agent-modal')).toBeInTheDocument()
    expect(
      screen.getByTestId('create-agent-modal-backdrop'),
    ).toBeInTheDocument()
    // role="dialog" + aria-modal for assistive tech.
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('Esc key calls onClose', () => {
    mockFetch({})
    const onClose = vi.fn()
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('backdrop click calls onClose; click on the dialog body does not', () => {
    mockFetch({})
    const onClose = vi.fn()
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={onClose} />)
    // Click on the dialog body (e.stopPropagation prevents bubbling)
    fireEvent.click(screen.getByTestId('create-agent-modal'))
    expect(onClose).not.toHaveBeenCalled()
    // Click on the backdrop closes
    fireEvent.click(screen.getByTestId('create-agent-modal-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pre-fills the image field from /api/fleet/harness-defaults on open', async () => {
    mockFetch({
      defaultImage:
        '398152419239.dkr.ecr.us-east-1.amazonaws.com/ender-stack/companion-openclaw:1dcff0d',
    })
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByLabelText(/Container image/i)).toHaveValue(
        '398152419239.dkr.ecr.us-east-1.amazonaws.com/ender-stack/companion-openclaw:1dcff0d',
      )
    })
  })

  it('refetches and applies fresh default on second open (round-3 audit — no stale cache)', async () => {
    // Round-3 audit P2: defaultsByHarness was preserved across
    // open/close, so a smoke-test image bumped between the first
    // close and the second open would have shown the stale value
    // (synchronous pre-fill from cache → guard blocks the fresh
    // fetch's update). Close effect now clears the cache so each
    // open starts with empty defaults and only the latest fetch
    // populates them.
    let callCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : (input as URL | Request).toString()
      if (url.includes('/api/fleet/harness-defaults')) {
        callCount += 1
        const image =
          callCount === 1
            ? 'ghcr.io/stroupaloop/openclaw:sha-OLD'
            : 'ghcr.io/stroupaloop/openclaw:sha-NEW'
        return new Response(
          JSON.stringify({
            defaults: {
              'companion/openclaw': {
                defaultImage: image,
                agentNameMaxLength: 32,
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ) as unknown as Response
      }
      throw new Error(`Unmocked: ${url}`)
    })

    const { rerender } = render(
      <CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />,
    )
    await waitFor(() =>
      expect(screen.getByLabelText(/Container image/i)).toHaveValue(
        'ghcr.io/stroupaloop/openclaw:sha-OLD',
      ),
    )
    // Close.
    rerender(
      <CreateAgentForm open={false} onCreated={vi.fn()} onClose={vi.fn()} />,
    )
    // Reopen — second fetch returns the new sha; the field MUST show
    // it, not the cached OLD value.
    rerender(
      <CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />,
    )
    await waitFor(() =>
      expect(screen.getByLabelText(/Container image/i)).toHaveValue(
        'ghcr.io/stroupaloop/openclaw:sha-NEW',
      ),
    )
  })

  it('does not re-pre-fill after the operator clears the field (round-2 audit)', async () => {
    // Round-2 audit caught: previous guard fired on every empty-
    // string state, so "Ctrl+A + Delete to retype" snapped the
    // pre-filled value back. New guard tracks user-edit intent via
    // a ref. Once the operator changes the field (even to ''), the
    // pre-fill effect must NOT re-fire for the rest of the open
    // session.
    mockFetch({
      defaultImage: 'ghcr.io/stroupaloop/openclaw:sha-default',
    })
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    // Wait for the default to land.
    await waitFor(() => {
      expect(screen.getByLabelText(/Container image/i)).toHaveValue(
        'ghcr.io/stroupaloop/openclaw:sha-default',
      )
    })
    // Operator clears the field — onChange fires with empty string.
    fireEvent.change(screen.getByLabelText(/Container image/i), {
      target: { value: '' },
    })
    // Field stays empty; the pre-fill effect does NOT re-fire.
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByLabelText(/Container image/i)).toHaveValue('')
  })

  it('does not stomp operator-typed image with the fetched default', async () => {
    // Simulate the operator typing before defaults arrive — the
    // useEffect that pre-fills only fires when `image === ''`.
    mockFetch({ defaultImage: 'ghcr.io/stroupaloop/openclaw:sha-default' })
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Container image/i), {
      target: { value: 'ghcr.io/stroupaloop/openclaw:sha-typed' },
    })
    // Even after the defaults fetch resolves, operator's value stays.
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByLabelText(/Container image/i)).toHaveValue(
      'ghcr.io/stroupaloop/openclaw:sha-typed',
    )
  })

  it('honors agentNameMaxLength from harness-defaults — rejects names longer than the per-deployment cap (round-3b.2)', async () => {
    // Server returns 10 (the ender-stack-dev cap); names longer than
    // that fail client validation immediately. Catches the "looks
    // valid by regex but exceeds AWS target-group-name limit" trap.
    mockFetch({ agentNameMaxLength: 10 })
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    // Wait for the harness-defaults response so the maxLength is in
    // state before we attempt the fill.
    await waitFor(() => {
      expect(screen.getByLabelText(/Agent name/i)).toHaveAttribute(
        'maxlength',
        '10',
      )
    })
    fill({ agentName: 'agent-name-too-long-for-deployment' })
    expect(
      screen.getByRole('button', { name: /Create agent/i }),
    ).toBeDisabled()
  })

  it('accepts a 10-char agent name when the per-deployment cap is 10', async () => {
    mockFetch({ agentNameMaxLength: 10 })
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByLabelText(/Agent name/i)).toHaveAttribute(
        'maxlength',
        '10',
      ),
    )
    fill({ agentName: 'bot-v2-prd' })
    expect(
      screen.getByRole('button', { name: /Create agent/i }),
    ).not.toBeDisabled()
  })

  it('surfaces a banner when /api/fleet/harness-defaults returns 500 (PrefixTooLongForHarness — round-6 audit operator-trap fix)', async () => {
    // Round-6 audit caught: previously `if (!resp.ok) return`
    // silently swallowed PrefixTooLongForHarness 500s, leaving the
    // form looking functional but submitting names that always 400.
    // Now the form parses the error body and surfaces a banner with
    // the code + detail so operators see the deployment misconfig.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : (input as URL | Request).toString()
      if (url.includes('/api/fleet/harness-defaults')) {
        return new Response(
          JSON.stringify({
            error: 'PrefixTooLongForHarness',
            detail:
              'prefix "really-really-long-prefix-staging" leaves only 1 chars for the agent-name segment, but agent names require at least 3',
          }),
          {
            status: 500,
            headers: { 'content-type': 'application/json' },
          },
        ) as unknown as Response
      }
      throw new Error(`Unmocked: ${url}`)
    })

    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() =>
      expect(
        screen.getByTestId('create-agent-defaults-error'),
      ).toBeInTheDocument(),
    )
    const banner = screen.getByTestId('create-agent-defaults-error')
    expect(banner).toHaveTextContent('PrefixTooLongForHarness')
    expect(banner).toHaveTextContent('really-really-long-prefix-staging')
    // Round-7 audit upgraded the banner copy from hedged
    // "Form pre-fill unavailable" to definitive "Cannot create
    // agents" for PrefixTooLongForHarness specifically — that
    // error means EVERY submit will fail; submit is also disabled.
    expect(banner).toHaveTextContent(/Cannot create agents/)
    // Even with a valid-looking name typed, submit is disabled
    // because formValid bakes in defaultsErrorBlocksSubmit.
    fill({ agentName: 'mybot' })
    expect(
      screen.getByRole('button', { name: /Create agent/i }),
    ).toBeDisabled()
  })

  it('shows hedged banner + KEEPS submit enabled for non-blocking harness-defaults errors (round-7 audit)', async () => {
    // For non-PrefixTooLongForHarness 5xx (e.g. transient AWS
    // throttle upstream of the ECS lookup, JSON parse failure on
    // a downstream service), the form falls back to maxLength=32
    // and the server-side gate still applies. Submit stays enabled
    // — operator can still type a name the server accepts.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : (input as URL | Request).toString()
      if (url.includes('/api/fleet/harness-defaults')) {
        return new Response(JSON.stringify({ error: 'TransientUpstream' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }) as unknown as Response
      }
      throw new Error(`Unmocked: ${url}`)
    })

    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() =>
      expect(
        screen.getByTestId('create-agent-defaults-error'),
      ).toBeInTheDocument(),
    )
    const banner = screen.getByTestId('create-agent-defaults-error')
    expect(banner).toHaveTextContent(/Form pre-fill unavailable/)
    expect(banner).toHaveTextContent('TransientUpstream')
    fill({ agentName: 'mybot' })
    // Submit enabled — server-side validation is the authoritative
    // gate when defaults aren't available.
    expect(
      screen.getByRole('button', { name: /Create agent/i }),
    ).not.toBeDisabled()
  })

  it('marks Agent name, Container image, and Role description as required (visual asterisks + native required attr for screen readers)', () => {
    mockFetch({})
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    // Modal renders via React.createPortal into document.body, so
    // the rendered container is empty — query the document directly.
    const marks = document.body.querySelectorAll('[data-testid="required-mark"]')
    expect(marks.length).toBe(3)
    const labelTexts = Array.from(marks).map(
      (m) => m.parentElement?.textContent ?? '',
    )
    expect(labelTexts.some((t) => t.includes('Agent name'))).toBe(true)
    expect(labelTexts.some((t) => t.includes('Container image'))).toBe(true)
    expect(labelTexts.some((t) => t.includes('Role description'))).toBe(true)
    // Marks are decorative — aria-hidden so screen readers rely on
    // the native `required` attribute on the inputs (the canonical
    // semantic signal).
    Array.from(marks).forEach((m) => {
      expect(m.getAttribute('aria-hidden')).toBe('true')
    })
    // Inputs have the native required attribute that screen readers
    // surface as "required field" announcements.
    expect(screen.getByLabelText(/Agent name/i)).toBeRequired()
    expect(screen.getByLabelText(/Container image/i)).toBeRequired()
    expect(screen.getByLabelText(/Role description/i)).toBeRequired()
  })

  it('accepts an agent name starting with a digit (date prefix like `2026-04-30-bot`)', () => {
    // Beat 3b.1 relaxed AGENT_NAME_RE — leading digits are valid AWS
    // resource names. The previous restriction blocked dated builds.
    mockFetch({})
    render(<CreateAgentForm open={true} onCreated={vi.fn()} onClose={vi.fn()} />)
    fill({ agentName: '2026-04-30-bot' })
    expect(
      screen.getByRole('button', { name: /Create agent/i }),
    ).not.toBeDisabled()
  })
})
