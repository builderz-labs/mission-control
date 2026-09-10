import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('chat first-rail contract', () => {
  it('keeps NavRail mounted on /chat and collapses it on enter', () => {
    const page = source('src/app/[[...panel]]/page.tsx')
    expect(page).toContain('{!showOnboarding && <NavRail />}')
    expect(page).toContain("if (normalizedPanel === 'chat')")
    expect(page).toContain('setSidebarExpanded(false)')
    expect(page).not.toContain('!isChatDesktop && <NavRail')
    expect(page).toContain("'flex-1 overflow-hidden pb-16 md:pb-0'")
  })
})
