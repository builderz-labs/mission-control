'use client'

import { useEffect, useState } from 'react'

interface Notification {
  id: number
  recipient: string
  type: string
  title: string
  message: string
  source_type?: string
  source_id?: number
  read_at?: number
  delivered_at?: number
  created_at: number
}

export function NotificationsPanel() {
  const [recipient, setRecipient] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    return window.localStorage.getItem('mc.notifications.recipient') || ''
  })
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchNotifications = async () => {
    if (!recipient) return
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/notifications?recipient=${encodeURIComponent(recipient)}`)
      if (!response.ok) throw new Error('Failed to fetch notifications')
      const data = await response.json()
      setNotifications(data.notifications || [])
    } catch (err) {
      setError('Failed to fetch notifications')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (recipient) {
      window.localStorage.setItem('mc.notifications.recipient', recipient)
      fetchNotifications()
    }
  }, [recipient])

  useEffect(() => {
    if (!recipient) return
    const interval = setInterval(fetchNotifications, 5000)
    return () => clearInterval(interval)
  }, [recipient])

  const markAllRead = async () => {
    if (!recipient) return
    await fetch('/api/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient, markAllRead: true })
    })
    fetchNotifications()
  }

  const markRead = async (id: number) => {
    await fetch('/api/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] })
    })
    fetchNotifications()
  }

  return (
    <div className="h-full flex flex-col bg-gray-900">
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <h2 className="text-xl font-bold text-white">Notifications</h2>
        <button
          onClick={markAllRead}
          className="px-3 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm"
        >
          Mark All Read
        </button>
      </div>

      <div className="p-4 border-b border-gray-700">
        <label className="block text-sm text-gray-400 mb-2">Recipient</label>
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Agent name (e.g., Jarvis)"
        />
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-500 text-red-400 p-3 m-4 rounded">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="text-gray-400 text-sm">Loading notifications...</div>
        ) : notifications.length === 0 ? (
          <div className="text-gray-500 text-sm">No notifications.</div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={`rounded-lg p-3 border ${
                n.read_at ? 'border-gray-700 bg-gray-800' : 'border-blue-500 bg-gray-800/70'
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-sm font-semibold text-white">{n.title}</div>
                  <div className="text-xs text-gray-400">{n.type}</div>
                </div>
                {!n.read_at && (
                  <button
                    onClick={() => markRead(n.id)}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Mark read
                  </button>
                )}
              </div>
              <div className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">{n.message}</div>
              <div className="text-xs text-gray-500 mt-2">
                {new Date(n.created_at * 1000).toLocaleString()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
