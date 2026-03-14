import { getDatabase } from './db'

export interface VirtualOfficeMessage {
  id: string
  agent: string
  message: string
  type: 'text' | 'tool' | 'document' | string
  thinking?: string
  timestamp: string
}

export const virtualOfficeDb = {
  getRecentMessages: (limit = 100): VirtualOfficeMessage[] => {
    const db = getDatabase()
    const stmt = db.prepare(`
      SELECT * FROM virtual_office_messages
      ORDER BY timestamp DESC
      LIMIT ?
    `)
    const rows = stmt.all(limit) as any[]
    
    // Reverse so the oldest of the recent messages comes first, matching chatting UI layout
    return rows.reverse().map(row => ({
      id: row.id,
      agent: row.agent,
      message: row.message,
      type: row.type,
      thinking: row.thinking || undefined,
      timestamp: row.timestamp
    }))
  },
  
  insertMessage: (msg: VirtualOfficeMessage) => {
    const db = getDatabase()
    const stmt = db.prepare(`
      INSERT INTO virtual_office_messages (id, agent, message, type, thinking, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    stmt.run(msg.id, msg.agent, msg.message, msg.type, msg.thinking || null, msg.timestamp)
  },

  clearAll: () => {
    const db = getDatabase()
    db.exec(`DELETE FROM virtual_office_messages`)
  }
}
