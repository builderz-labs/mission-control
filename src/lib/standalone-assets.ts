import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const STANDALONE_BRAND_LOGO = join('public', 'brand', 'mc-logo-128.png')

export function standaloneReleaseIntact(cwd = process.cwd()): boolean {
  try {
    if (!existsSync(cwd)) return false
    const logo = join(cwd, STANDALONE_BRAND_LOGO)
    return existsSync(logo) && statSync(logo).size > 0
  } catch {
    return false
  }
}
