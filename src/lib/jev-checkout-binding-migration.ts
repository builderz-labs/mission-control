import type { Migration } from './migrations'
import { allSeedProjects } from './fleet-projects'

export const jevCheckoutBindingMigration: Migration = {
  id: '067_jev_project_checkouts',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS jev_project_checkouts (
        project_id INTEGER PRIMARY KEY,
        workspace_id INTEGER NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_jev_project_checkouts_workspace
        ON jev_project_checkouts(workspace_id, project_id);
    `)

    // Preserve existing owner-workspace fleet bindings without granting local
    // filesystem access to projects in secondary tenant workspaces.
    const owner = db.prepare(`
      SELECT id FROM workspaces
      ORDER BY CASE WHEN slug = 'default' THEN 0 ELSE 1 END, id ASC LIMIT 1
    `).get() as { id: number } | undefined
    if (!owner) return
    const bind = db.prepare(`
      INSERT OR IGNORE INTO jev_project_checkouts (project_id, workspace_id, root_path)
      SELECT id, workspace_id, ? FROM projects
      WHERE workspace_id = ? AND slug = ? AND description = ?
    `)
    for (const project of allSeedProjects()) {
      bind.run(project.path, owner.id, project.slug, project.path)
    }
  },
}
