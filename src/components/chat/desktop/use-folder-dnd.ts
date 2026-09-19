'use client'

import { useCallback, useLayoutEffect, useRef, useState, type DragEvent, type RefObject } from 'react'

const DURATION_MS = 200

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function measure(list: HTMLElement): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>()
  list.querySelectorAll<HTMLElement>('[data-folder-key]').forEach((node) => {
    const key = node.dataset.folderKey
    if (key) map.set(key, node.getBoundingClientRect())
  })
  return map
}

export function reorderKeys(keys: string[], from: string, to: string): string[] {
  const next = [...keys]
  const fromIndex = next.indexOf(from)
  const toIndex = next.indexOf(to)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return keys
  next.splice(fromIndex, 1)
  next.splice(toIndex, 0, from)
  return next
}

export { applyFolderOrder } from '@/lib/chat-folder-order'

export type FolderDragProps = {
  'data-folder-key': string
  draggable: boolean
  onDragStart: (event: DragEvent) => void
  onDragOver: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
  onDragEnd: () => void
}

function playFlip(list: HTMLElement, first: Map<string, DOMRect>) {
  if (prefersReducedMotion()) return
  const last = measure(list)
  last.forEach((rect, key) => {
    const prev = first.get(key)
    const node = Array.from(list.querySelectorAll<HTMLElement>('[data-folder-key]')).find((el) => el.dataset.folderKey === key)
    if (!prev || !node) return
    const dy = prev.top - rect.top
    if (!dy) return
    node.style.transition = 'none'
    node.style.transform = `translateY(${dy}px)`
    requestAnimationFrame(() => {
      node.style.transition = `transform ${DURATION_MS}ms ease-out, opacity ${DURATION_MS}ms ease-out`
      node.style.transform = 'translateY(0)'
      window.setTimeout(() => {
        node.style.transition = ''
        node.style.transform = ''
      }, DURATION_MS)
    })
  })
}

export function useFolderDnd({
  keys,
  onReorder,
  listRef,
}: {
  keys: string[]
  onReorder: (next: string[]) => void
  listRef: RefObject<HTMLElement | null>
}) {
  const [dragging, setDragging] = useState<string | null>(null)
  const pendingFirst = useRef<Map<string, DOMRect> | null>(null)

  useLayoutEffect(() => {
    const first = pendingFirst.current
    const list = listRef.current
    if (!first || !list) return
    pendingFirst.current = null
    playFlip(list, first)
  }, [keys, listRef])

  const folderProps = useCallback((key: string): FolderDragProps => ({
    'data-folder-key': key,
    draggable: true,
    onDragStart: (event: DragEvent) => {
      if ((event.target as HTMLElement).closest('button')) {
        event.preventDefault()
        return
      }
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', key)
      setDragging(key)
    },
    onDragOver: (event: DragEvent) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      const from = event.dataTransfer.getData('text/plain') || dragging
      if (!from || from === key) return
      if (listRef.current) pendingFirst.current = measure(listRef.current)
      onReorder(reorderKeys(keys, from, key))
      setDragging(null)
    },
    onDragEnd: () => setDragging(null),
  }), [dragging, keys, listRef, onReorder])

  return { dragging, folderProps }
}
