/**
 * Skill Registry — legacy entry point re-exported from the split module tree.
 * @see ./skill-registry/index.ts for the implementation.
 */

export {
  searchRegistry,
  installFromRegistry,
  checkSkillSecurity,
  type RegistrySource,
  type RegistrySkill,
  type RegistrySearchResult,
  type InstallRequest,
  type InstallResult,
  type SecurityReport,
  type SecurityIssue,
} from './skill-registry/index'
