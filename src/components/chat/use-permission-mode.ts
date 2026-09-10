'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { apiFetch } from '@/lib/api-client'
import { parsePermissionMode, type UnifiedPermissionMode } from '@/lib/permission-connector'

type Snapshot = { mode: UnifiedPermissionMode; allowed: boolean; loaded: boolean }

let snapshot: Snapshot = { mode: 'ask', allowed: false, loaded: false }
const listeners = new Set<() => void>()

function emit(next: Snapshot) {
  snapshot = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return snapshot
}

export function usePermissionMode() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ mode?: unknown; allowed?: boolean }>('/api/chat/permission-mode')
      emit({
        mode: parsePermissionMode(data.mode),
        allowed: data.allowed === true,
        loaded: true,
      })
    } catch {
      emit({ ...snapshot, loaded: true, allowed: false, mode: 'ask' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const setMode = useCallback(async (mode: UnifiedPermissionMode) => {
    if (!snapshot.allowed) return
    const previous = snapshot
    emit({ ...snapshot, mode })
    try {
      const data = await apiFetch<{ mode?: unknown; allowed?: boolean }>('/api/chat/permission-mode', {
        method: 'PUT',
        body: JSON.stringify({ mode }),
      })
      emit({
        mode: parsePermissionMode(data.mode),
        allowed: data.allowed !== false,
        loaded: true,
      })
    } catch {
      emit(previous)
    }
  }, [])

  return { ...state, setMode }
}
