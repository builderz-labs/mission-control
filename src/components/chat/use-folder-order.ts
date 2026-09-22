'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { parseFolderOrder } from '@/lib/chat-folder-order'
import { useSmartPoll } from '@/lib/use-smart-poll'

const LOCAL_PREFIX = 'mc.chat-desktop.order.'

function readLegacyOrder(userId: number | string | undefined): string[] {
  if (typeof window === 'undefined') return []
  return parseFolderOrder(window.localStorage.getItem(`${LOCAL_PREFIX}${userId ?? 'anon'}`))
}

function clearLegacyOrder(userId: number | string | undefined): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(`${LOCAL_PREFIX}${userId ?? 'anon'}`)
}

export function useFolderOrder(userId: number | string | undefined) {
  const [folderOrder, setFolderOrder] = useState<string[]>([])
  const pending = useRef(false)
  const migrated = useRef(false)

  const load = useCallback(async () => {
    if (pending.current) return
    try {
      const data = await apiFetch<{ order?: unknown }>('/api/chat/folder-order')
      const server = parseFolderOrder(JSON.stringify(data.order ?? []))
      if (!migrated.current && server.length === 0) {
        const legacy = readLegacyOrder(userId)
        migrated.current = true
        if (legacy.length > 0) {
          pending.current = true
          setFolderOrder(legacy)
          try {
            await apiFetch('/api/chat/folder-order', {
              method: 'PUT',
              body: JSON.stringify({ order: legacy }),
            })
            clearLegacyOrder(userId)
          } catch {
            /* keep legacy locally until a later save succeeds */
          } finally {
            pending.current = false
          }
          return
        }
      }
      migrated.current = true
      setFolderOrder(server)
    } catch {
      if (!migrated.current) {
        migrated.current = true
        setFolderOrder(readLegacyOrder(userId))
      }
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  useSmartPoll(load, 15_000, { enabled: true })

  const save = useCallback(async (next: string[]) => {
    const previous = folderOrder
    setFolderOrder(next)
    pending.current = true
    try {
      await apiFetch('/api/chat/folder-order', {
        method: 'PUT',
        body: JSON.stringify({ order: next }),
      })
      clearLegacyOrder(userId)
    } catch {
      setFolderOrder(previous)
    } finally {
      pending.current = false
    }
  }, [folderOrder, userId])

  return { folderOrder, setFolderOrder: save }
}
