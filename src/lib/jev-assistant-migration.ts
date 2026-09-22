import type { Migration } from './migrations'

export const jevAssistantMigration: Migration = {
  id: '066_jev_policy_configuration',
  up(db) {
    const columns = db.prepare('PRAGMA table_info(jev_policies)').all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'configuration')) {
      db.exec('ALTER TABLE jev_policies ADD COLUMN configuration TEXT')
    }
  },
}
