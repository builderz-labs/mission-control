import type { Migration } from './migrations'

export const jevSessionPrincipalMigration: Migration = {
  id: '071_jev_session_principals',
  up(db) {
    const columns = db.pragma('table_info(jev_setup_sessions)') as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'created_by_principal')) {
      db.exec('ALTER TABLE jev_setup_sessions ADD COLUMN created_by_principal TEXT')
    }
    db.exec(`
      UPDATE jev_setup_sessions
      SET created_by_principal='user:' || created_by_user_id
      WHERE created_by_principal IS NULL OR created_by_principal='';
      CREATE INDEX IF NOT EXISTS idx_jev_setup_sessions_principal
        ON jev_setup_sessions(workspace_id, created_by_principal, updated_at DESC);
    `)
  },
}
