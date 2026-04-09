// Barrel re-export for the auth domain.
// Consumers importing from '@/lib/auth' or '../auth' continue to work unchanged.

export type { User, UserSession, SessionQueryRow, UserQueryRow } from './types'
export { getDefaultWorkspaceContext, resolveTenantForWorkspace } from './workspace-context'
export { createSession, validateSession, destroySession, destroyAllUserSessions } from './session'
export {
  authenticateUser,
  getUserById,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  resolveOrProvisionProxyUser,
} from './users'
export {
  safeCompare,
  hashApiKey,
  extractApiKeyFromHeaders,
  resolveActiveApiKey,
  parseAgentScopes,
  deriveRoleFromScopes,
} from './api-keys'
export {
  registerAuthResolver,
  getUserFromRequest,
  requireRole,
  getWorkspaceIdFromRequest,
  getTenantIdFromRequest,
} from './request'
