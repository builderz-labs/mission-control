import type { Migration } from './migrations'
import { jevSetupSessionMigration } from './jev-setup-session-migration'
import { jevCloudMigration } from './jev-cloud-migration'

// Early installations applied 068/069 before revision-policy links were added.
// A new migration ID is essential: changing an already-applied migration does
// not upgrade those databases. Both original operations are additive/idempotent.
export const jevSetupUpgradeMigration: Migration = {
  id: '072_jev_setup_revision_links_upgrade',
  up(db) {
    jevSetupSessionMigration.up(db)
    jevCloudMigration.up(db)
  },
}
