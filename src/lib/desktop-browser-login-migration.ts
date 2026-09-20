import type { Migration } from './migrations'

export const desktopBrowserLoginMigration: Migration = {
  id: '065_desktop_browser_login',
  up(db) {
    db.exec(`
      CREATE TABLE desktop_browser_logins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_digest TEXT NOT NULL UNIQUE,
        code_digest TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'consumed')),
        requested_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        approved_at INTEGER,
        approved_by INTEGER,
        workspace_id INTEGER,
        tenant_id INTEGER,
        consumed_at INTEGER,
        FOREIGN KEY(approved_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_desktop_browser_logins_expiry
        ON desktop_browser_logins(expires_at, status);
    `)
  },
}
