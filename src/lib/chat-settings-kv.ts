import { getDatabase } from '@/lib/db'

export function loadSettingValue(key: string): string | null {
  const row = getDatabase()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function saveSettingValue(
  key: string,
  value: string,
  description: string,
  username: string,
): void {
  const now = Math.floor(Date.now() / 1000)
  getDatabase().prepare(`
    INSERT INTO settings (key, value, description, category, updated_by, updated_at)
    VALUES (?, ?, ?, 'chat', ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(key, value, description, username, now)
}

export function permissionModeKey(userId: number): string {
  return `chat.permission_mode.user.${userId}`
}

export const FOLDER_ORDER_KEY = 'chat.folder_order.v1'
