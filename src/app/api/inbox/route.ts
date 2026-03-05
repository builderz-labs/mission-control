import { NextRequest, NextResponse } from 'next/server'
import { getInboxItems, getInboxCounts, type InboxSourceType } from '@/lib/cc-db'
import { getDatabase } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const source = searchParams.get('source') as InboxSourceType | null
    const limit = parseInt(searchParams.get('limit') || '50', 10)

    const items = getInboxItems(source || undefined, limit)
    const counts = getInboxCounts()

    // Add notification count from MC's own db
    const mcDb = getDatabase()
    const notifCount = (mcDb.prepare(
      `SELECT COUNT(*) as c FROM notifications WHERE read_at IS NULL`
    ).get() as { c: number }).c
    counts.notification = notifCount

    // Add notification items if not filtered or filtered to notifications
    if (!source || source === 'notification') {
      const notifications = mcDb.prepare(
        `SELECT * FROM notifications WHERE read_at IS NULL ORDER BY created_at DESC LIMIT ?`
      ).all(limit) as Array<{
        id: number
        recipient: string
        type: string
        title: string
        message: string
        source_type: string | null
        source_id: number | null
        created_at: number
      }>

      for (const n of notifications) {
        items.push({
          id: `notification-${n.id}`,
          source: 'notification',
          title: n.title,
          subtitle: n.message,
          icon: '🔔',
          badge: n.type,
          badgeColor: 'amber',
          timestamp: n.created_at * 1000, // convert unix seconds to ms
          actionUrl: n.source_type === 'task' ? `tasks?id=${n.source_id}` : undefined,
          metadata: {
            recipient: n.recipient,
            type: n.type,
            source_type: n.source_type,
            source_id: n.source_id,
          },
        })
      }

      // Re-sort after adding notifications
      items.sort((a, b) => b.timestamp - a.timestamp)
    }

    return NextResponse.json({ items: items.slice(0, limit), counts })
  } catch (error) {
    console.error('Inbox API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch inbox' },
      { status: 500 }
    )
  }
}
