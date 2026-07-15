import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('release update client contract', () => {
  it('sends the explicit server-side confirmation literal', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/layout/update-banner.tsx'), 'utf8')

    expect(source).toContain("confirmation: 'update_mission_control'")
  })
})
