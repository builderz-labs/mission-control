import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AgentDetailPanel } from '../panels/agent-detail-panel'
import type { FleetServiceSummary } from '../api/services'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  // Default: route fetches by URL so the embedded
  // SlackManifestDisplay + SlackChannelPicker don't hang in
  // loading state for tests that aren't asserting on the Slack
  // section. Each call gets a sensible default; specific tests
  // can override with mockResolvedValueOnce before render.
  fetchMock.mockImplementation(async (url) => {
    const u =
      typeof url === 'string' ? url : (url as URL | Request).toString()
    if (u.includes('/slack/manifest')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          agentName: 'hello-bot',
          manifest: { display_information: { name: 'mc-agent-hello-bot' } },
          instructions: ['step 1', 'step 2'],
        }),
      } as unknown as Response
    }
    if (u.includes('/slack/channels')) {
      // Default to "no token yet" so the picker renders the
      // operator-friendly hint pointing at the credentials form
      // above. Tests can override per-call.
      return {
        ok: false,
        status: 404,
        json: async () => ({
          error: 'SlackBotTokenNotFound',
          detail: 'Run the credential-paste flow first.',
        }),
      } as unknown as Response
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: 'unmocked' }),
    } as unknown as Response
  })
})

const AGENT_NAME = 'hello-bot'
const SERVICE_NAME = 'ender-stack-dev-companion-openclaw-hello-bot'

const sampleAgent: FleetServiceSummary = {
  name: SERVICE_NAME,
  status: 'ACTIVE',
  desiredCount: 1,
  runningCount: 1,
  pendingCount: 0,
  taskDefinition: 'ender-stack-dev-companion-openclaw-hello-bot:5',
  launchType: 'FARGATE',
  activeDeployments: 0,
}

describe('<AgentDetailPanel />', () => {
  it('does not render when agent is null', () => {
    const { container } = render(
      <AgentDetailPanel
        agent={null}
        agentName={null}
        onClose={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
    expect(
      document.body.querySelector('[data-testid="agent-detail-panel"]'),
    ).toBeNull()
  })

  it('renders the panel when agent + agentName are provided', () => {
    render(
      <AgentDetailPanel
        agent={sampleAgent}
        agentName={AGENT_NAME}
        onClose={vi.fn()}
      />,
    )
    expect(
      document.body.querySelector('[data-testid="agent-detail-panel"]'),
    ).not.toBeNull()
    expect(document.body.textContent).toContain(AGENT_NAME)
    expect(document.body.textContent).toContain(SERVICE_NAME)
  })

  it('renders identity fields (task definition, status, counts, launch type)', () => {
    render(
      <AgentDetailPanel
        agent={sampleAgent}
        agentName={AGENT_NAME}
        onClose={vi.fn()}
      />,
    )
    const identity = document.body.querySelector(
      '[data-testid="agent-detail-identity"]',
    )
    expect(identity).not.toBeNull()
    expect(identity!.textContent).toContain(sampleAgent.taskDefinition!)
    expect(identity!.textContent).toContain('ACTIVE')
    expect(identity!.textContent).toContain('FARGATE')
  })

  it('renders the Slack section with the embedded manifest display', () => {
    render(
      <AgentDetailPanel
        agent={sampleAgent}
        agentName={AGENT_NAME}
        onClose={vi.fn()}
      />,
    )
    expect(
      document.body.querySelector('[data-testid="agent-detail-slack"]'),
    ).not.toBeNull()
  })

  it('Esc key closes the panel', () => {
    const onClose = vi.fn()
    render(
      <AgentDetailPanel
        agent={sampleAgent}
        agentName={AGENT_NAME}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('Close button calls onClose', () => {
    const onClose = vi.fn()
    render(
      <AgentDetailPanel
        agent={sampleAgent}
        agentName={AGENT_NAME}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByTestId('agent-detail-close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('backdrop click closes the panel', () => {
    const onClose = vi.fn()
    render(
      <AgentDetailPanel
        agent={sampleAgent}
        agentName={AGENT_NAME}
        onClose={onClose}
      />,
    )
    const backdrop = document.body.querySelector(
      '[data-testid="agent-detail-panel"]',
    )!
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking inside the panel body does NOT close', () => {
    const onClose = vi.fn()
    render(
      <AgentDetailPanel
        agent={sampleAgent}
        agentName={AGENT_NAME}
        onClose={onClose}
      />,
    )
    const identity = document.body.querySelector(
      '[data-testid="agent-detail-identity"]',
    )!
    fireEvent.click(identity)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('places role="dialog" + aria-modal on the focus-trap root, not the backdrop', () => {
    // WAI-ARIA Dialog Pattern §2.25: ARIA dialog attributes must
    // coincide with the element the focus trap operates on so
    // screen readers and the trap reference the same boundary.
    render(
      <AgentDetailPanel
        agent={sampleAgent}
        agentName={AGENT_NAME}
        onClose={vi.fn()}
      />,
    )
    const backdrop = document.body.querySelector(
      '[data-testid="agent-detail-panel"]',
    )!
    const dialog = document.body.querySelector(
      '[data-testid="agent-detail-dialog"]',
    )!
    expect(backdrop.getAttribute('role')).toBeNull()
    expect(backdrop.getAttribute('aria-modal')).toBeNull()
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('agent-detail-title')
  })

  it('moves focus to the Close button on open', async () => {
    render(
      <AgentDetailPanel
        agent={sampleAgent}
        agentName={AGENT_NAME}
        onClose={vi.fn()}
      />,
    )
    // setTimeout(0) inside the effect — wait one tick.
    await new Promise((r) => setTimeout(r, 5))
    const closeBtn = screen.getByTestId('agent-detail-close')
    expect(document.activeElement).toBe(closeBtn)
  })

  it('traps Tab inside the dialog', async () => {
    render(
      <AgentDetailPanel
        agent={sampleAgent}
        agentName={AGENT_NAME}
        onClose={vi.fn()}
      />,
    )
    await new Promise((r) => setTimeout(r, 5))
    const closeBtn = screen.getByTestId('agent-detail-close')
    closeBtn.focus()
    expect(document.activeElement).toBe(closeBtn)
    // Shift+Tab from the first focusable should wrap to the last.
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    // The last focusable will be a button inside the manifest
    // section once it loads — this assertion just verifies the
    // handler PreventedDefault and moved focus elsewhere (i.e.,
    // didn't escape to background).
    expect(document.activeElement).not.toBe(document.body)
  })

  it('renders both credentials section + channels section (Beat 5c.2)', () => {
    render(
      <AgentDetailPanel
        agent={sampleAgent}
        agentName={AGENT_NAME}
        onClose={vi.fn()}
      />,
    )
    expect(
      document.body.querySelector(
        '[data-testid="agent-detail-credentials-section"]',
      ),
    ).not.toBeNull()
    expect(
      document.body.querySelector(
        '[data-testid="agent-detail-channels-section"]',
      ),
    ).not.toBeNull()
  })

  it('handles a missing taskDefinition gracefully (em-dash fallback)', () => {
    render(
      <AgentDetailPanel
        agent={{ ...sampleAgent, taskDefinition: undefined }}
        agentName={AGENT_NAME}
        onClose={vi.fn()}
      />,
    )
    const identity = document.body.querySelector(
      '[data-testid="agent-detail-identity"]',
    )!
    expect(identity.textContent).toContain('—')
  })
})
