/**
 * Skill Registry — public barrel.
 *
 * Existing imports from '@/lib/skill-registry' continue to work via this index.
 * Internal modules import directly from their sub-module for clarity.
 */

import { searchClawdHub, searchSkillsSh, searchAwesomeOpenclaw } from './sources'
import type { RegistrySource, RegistrySearchResult } from './types'

export type {
  RegistrySource,
  RegistrySkill,
  RegistrySearchResult,
  InstallRequest,
  InstallResult,
  SecurityReport,
  SecurityIssue,
} from './types'

export { checkSkillSecurity } from './security'
export { installFromRegistry } from './install'

/**
 * Dispatch a search to the appropriate registry source.
 */
export async function searchRegistry(
  source: RegistrySource,
  query: string
): Promise<RegistrySearchResult> {
  if (source === 'clawhub') return searchClawdHub(query)
  if (source === 'skills-sh') return searchSkillsSh(query)
  if (source === 'awesome-openclaw') return searchAwesomeOpenclaw(query)
  return { skills: [], total: 0, source }
}
