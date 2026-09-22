import type Database from 'better-sqlite3'
import { getDatabase } from './db'
import { assertJevProject, JevRecordError } from './jev-repository'
import { createJevSetupSession } from './jev-setup-session-repository'
import { serializeRedactedJevSetupValue } from './jev-setup-redaction'
import type { CreateJevSetupSessionInput } from './jev-setup-session-validation'

/** Save the reviewed input before invoking a provider, including during provider outages. */
export function createJevSetupSessionWithInput(
  input: CreateJevSetupSessionInput,
  scope: { workspaceId: number; tenantId: number; userId: number; principal?: string },
  db: Database.Database = getDatabase(),
) {
  if (input.initialInput) {
    if (!input.initialInput.projectIds.includes(input.projectId)) {
      throw new JevRecordError('Session project must be included in projectIds', 409)
    }
    for (const id of input.initialInput.projectIds) assertJevProject(scope.workspaceId, scope.tenantId, id, db)
  }
  return db.transaction(() => {
    const session = createJevSetupSession(input, scope, db)
    if (input.initialInput) db.prepare(`
      INSERT INTO jev_setup_messages (workspace_id,session_id,ordinal,role,content)
      VALUES (?,?,1,'user',?)
    `).run(scope.workspaceId, session.id, serializeRedactedJevSetupValue(input.initialInput))
    return session
  })()
}
