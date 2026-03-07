/**
 * Example Plugin: Hyperbrowser
 *
 * Reference showing how to register Hyperbrowser via the plugin system.
 * The actual Hyperbrowser integration lives as a built-in in the
 * integrations route (Phase 2). This file demonstrates the plugin API
 * for documentation purposes.
 *
 * Usage:
 *   import { initHyperbrowserPlugin } from '@/plugins/hyperbrowser-example'
 *   initHyperbrowserPlugin()
 */

import {
  registerIntegrations,
  registerCategories,
  registerToolProviders,
} from '@/lib/plugins'

export function initHyperbrowserPlugin(): void {
  registerCategories([
    { id: 'browser', label: 'Browser Automation', order: 8 },
  ])

  registerIntegrations([
    {
      id: 'hyperbrowser',
      name: 'Hyperbrowser',
      category: 'browser',
      envVars: ['HYPERBROWSER_API_KEY'],
      testable: true,
      recommendation: 'Cloud browser automation for AI agents. Get a key at hyperbrowser.ai',
      testHandler: async (envMap: Map<string, string>) => {
        const key = envMap.get('HYPERBROWSER_API_KEY') || process.env.HYPERBROWSER_API_KEY || ''
        if (!key) return { ok: false, detail: 'API key not set' }
        try {
          const res = await fetch('https://app.hyperbrowser.ai/api/v2/sessions', {
            headers: { 'x-api-key': key },
            signal: AbortSignal.timeout(5000),
          })
          return res.ok
            ? { ok: true, detail: 'API key valid' }
            : { ok: false, detail: `HTTP ${res.status}` }
        } catch (err: any) {
          return { ok: false, detail: err.message || 'Connection failed' }
        }
      },
    },
  ])

  registerToolProviders([
    {
      id: 'hyperbrowser',
      name: 'Hyperbrowser',
      tools: ['browser', 'web'],
      requiredIntegration: 'hyperbrowser',
    },
  ])
}
