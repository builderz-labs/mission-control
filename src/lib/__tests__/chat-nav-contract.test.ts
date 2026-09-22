import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { usesConversationShell } from '@/components/layout/dashboard-page-frame'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('chat first-rail contract', () => {
  it.each(['chat', 'jev'])('keeps NavRail mounted on /%s and collapses it on enter', (panel) => {
    const page = source('src/app/[[...panel]]/page.tsx')
    expect(usesConversationShell(panel)).toBe(true)
    expect(page).toContain('{!showOnboarding && <NavRail />}')
    expect(page).toContain('if (usesConversationShell(normalizedPanel))')
    expect(page).toContain('setSidebarExpanded(false)')
    expect(page).not.toContain('!isChatDesktop && <NavRail')
    expect(page).toContain("'flex-1 overflow-hidden pb-16 md:pb-0'")
  })
})
