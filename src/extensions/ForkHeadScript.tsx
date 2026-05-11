/**
 * Fork-level <head> script injection.
 *
 * Renders inline <script> tags that need to run before hydration. Currently
 * a no-op placeholder — reserved for:
 *   - Early feature flags from MC_PUBLIC_FLAGS
 *   - Analytics/telemetry shims that should load pre-hydration
 *   - Crash reporter init
 *
 * nonce prop is forwarded from layout.tsx's CSP nonce so inline scripts
 * pass strict CSP.
 */

type Props = {
  nonce?: string
}

export function ForkHeadScript({ nonce }: Props) {
  // No-op placeholder. Keep the component mounted so future fork features
  // can inject <script> tags here without touching src/app/layout.tsx.
  void nonce

  // Expose a small global flag so extension client code can detect fork
  // context without pulling in the full extensions config on first paint.
  // Also seed fork-default UI preferences in localStorage BEFORE the Zustand
  // store's IIFE reads them — that way upstream `src/store/index.ts` stays
  // byte-clean against upstream while fork users still get the expected
  // first-load UI state (e.g. expanded sidebar).
  const script = `
    window.__AMS_FORK__ = { deployEnv: ${JSON.stringify(process.env.MC_DEPLOY_ENV ?? 'unset')} };
    try {
      if (localStorage.getItem('mc-sidebar-expanded') === null) {
        localStorage.setItem('mc-sidebar-expanded', 'true');
      }
    } catch (e) { /* SSR / disabled storage / quota — fall through to upstream default */ }
  `.trim()

  return (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: script }}
    />
  )
}
