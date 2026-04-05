'use client'

// Thin shell — orchestrates view state and delegates all rendering to sub-components.
// Sub-components live in ./handoff-chains/

import { useState } from 'react'
import { ListView } from './handoff-chains/list-view'
import { BuilderView } from './handoff-chains/builder-view'
import type { HandoffChainParsed } from './handoff-chains/types'
import type { View } from './handoff-chains/types'

export function HandoffChainsPanel(): React.JSX.Element {
  const [view, setView] = useState<View>('list')
  const [editingChain, setEditingChain] = useState<HandoffChainParsed | null>(null)
  // Increment to force re-mount of ListView after a save (triggers fresh fetch)
  const [listKey, setListKey] = useState(0)

  const handleNew = (): void => {
    setEditingChain(null)
    setView('builder')
  }

  const handleEdit = (chain: HandoffChainParsed): void => {
    setEditingChain(chain)
    setView('builder')
  }

  const handleSaved = (): void => {
    setListKey(k => k + 1)
    setView('list')
    setEditingChain(null)
  }

  const handleCancel = (): void => {
    setView('list')
    setEditingChain(null)
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-primary shrink-0">
          <path d="M4 10h12M10 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-sm font-semibold text-foreground">Handoff Chains</span>
      </div>

      {view === 'list' && (
        <ListView key={listKey} onNew={handleNew} onEdit={handleEdit} />
      )}

      {view === 'builder' && (
        <BuilderView
          editing={editingChain}
          onSaved={handleSaved}
          onCancel={handleCancel}
        />
      )}
    </div>
  )
}
