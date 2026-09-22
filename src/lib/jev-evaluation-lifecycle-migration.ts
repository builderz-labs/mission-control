import type { Migration } from './migrations'

export const jevEvaluationLifecycleMigration: Migration = {
  id: '070_jev_evaluation_lifecycle',
  up(db) {
    db.exec(`
      ALTER TABLE jev_evaluations ADD COLUMN idempotency_key TEXT;
      ALTER TABLE jev_evaluations ADD COLUMN policy_name_snapshot TEXT;
      ALTER TABLE jev_evaluations ADD COLUMN policy_configuration_snapshot TEXT;
      CREATE UNIQUE INDEX idx_jev_evaluations_idempotency
        ON jev_evaluations(workspace_id,idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `)
  },
}
