'use client'

import React from 'react'

interface DeleteConfirmModalProps {
  fileName: string
  onClose: () => void
  onConfirm: () => void
}

export function DeleteConfirmModal({ fileName, onClose, onConfirm }: DeleteConfirmModalProps) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg max-w-md w-full p-6 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-red-400">Confirm Deletion</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl transition-smooth">{'\u00d7'}</button>
        </div>

        <div className="space-y-4">
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-lg">
            <p className="text-sm">You are about to permanently delete:</p>
            <p className="font-mono text-foreground mt-2 bg-surface-1 p-2 rounded-md text-sm">
              {fileName}
            </p>
            <p className="text-xs mt-2 text-red-400/70">
              This action cannot be undone.
            </p>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={onConfirm}
              className="flex-1 px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-md hover:bg-red-500/30 transition-smooth"
            >
              Delete Permanently
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-secondary text-muted-foreground rounded-md hover:bg-secondary/80 transition-smooth"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
