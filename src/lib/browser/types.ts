/**
 * Browser Automation Types
 * WHY: Mirrors the vercel-labs/agent-browser StepEvent model so output
 * format is compatible if we later swap in the Rust binary via sidecar.
 */

export type StepStatus = 'running' | 'done' | 'error'
export type BrowseMode = 'navigate' | 'screenshot' | 'extract' | 'click' | 'fill'

export interface StepEvent {
  readonly step: string
  readonly status: StepStatus
  readonly elapsed?: number   // milliseconds
  readonly data?: unknown
}

export interface BrowseResult {
  readonly url: string
  readonly title: string
  readonly content: string
  readonly screenshotPath: string | null
  readonly steps: ReadonlyArray<StepEvent>
  readonly durationMs: number
  readonly sessionId: number | null
}

export interface BrowseOptions {
  readonly timeout?: number        // ms, default 15000
  // WHY: waitForSelector is reserved for future Playwright integration.
  // The current fetch-based sandbox (sandbox.ts) does not support DOM-level selectors.
  // When Playwright is wired in, this field will be forwarded to page.waitForSelector().
  /** @reserved Not yet wired through to the fetch sandbox — Playwright integration pending */
  readonly waitForSelector?: string
  readonly extractSelector?: string
  readonly screenshot?: boolean
  readonly workspaceId?: number
  readonly agentId?: string
}

export interface NavigateOptions extends BrowseOptions {
  readonly mode: 'navigate'
}

export interface ScreenshotOptions {
  readonly workspaceId?: number
  readonly agentId?: string
}

export interface ExtractOptions extends BrowseOptions {
  readonly selector?: string
}
