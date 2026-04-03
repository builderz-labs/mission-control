'use client'

import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import type { ApiKeyInfo } from './settings-types'

interface SecuritySettingsProps {
  apiKeyInfo: ApiKeyInfo | null
  apiKeyLoading: boolean
  newApiKey: string | null
  rotateConfirm: boolean
  rotating: boolean
  keyCopied: boolean
  onSetRotateConfirm: (v: boolean) => void
  onRotateKey: () => void
  onCopyKey: () => void
  onDismissNewKey: () => void
}

export function SecuritySettings({
  apiKeyInfo,
  apiKeyLoading,
  newApiKey,
  rotateConfirm,
  rotating,
  keyCopied,
  onSetRotateConfirm,
  onRotateKey,
  onCopyKey,
  onDismissNewKey,
}: SecuritySettingsProps) {
  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">API Key</span>
              {apiKeyInfo?.source && (
                <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {apiKeyInfo.source}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Used for programmatic access and agent authentication via X-Api-Key header or Bearer token.
            </p>
          </div>
        </div>

        {/* Current key display */}
        <div className="mt-3 flex items-center gap-2">
          <code className="text-xs font-mono bg-background border border-border rounded px-2 py-1 text-muted-foreground">
            {apiKeyLoading ? 'Loading...' : apiKeyInfo?.masked_key || 'No API key configured'}
          </code>
        </div>

        {apiKeyInfo?.last_rotated_at && (
          <div className="text-2xs text-muted-foreground/50 mt-2">
            Last rotated by {apiKeyInfo.last_rotated_by} on{' '}
            {new Date(apiKeyInfo.last_rotated_at * 1000).toLocaleDateString()}{' '}
            at {new Date(apiKeyInfo.last_rotated_at * 1000).toLocaleTimeString()}
          </div>
        )}

        {/* Rotate confirmation */}
        {!rotateConfirm ? (
          <div className="mt-3">
            <Button onClick={() => onSetRotateConfirm(true)} variant="outline" size="sm">
              Rotate Key
            </Button>
          </div>
        ) : (
          <div className="mt-3 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <p className="text-xs text-amber-300 mb-2">
              Are you sure? Rotating the API key will immediately invalidate the current key.
              All agents and integrations using the old key will lose access.
            </p>
            <div className="flex items-center gap-2">
              <Button
                onClick={onRotateKey}
                disabled={rotating}
                variant="default"
                size="sm"
                className="bg-amber-600 hover:bg-amber-700"
              >
                {rotating ? 'Rotating...' : 'Confirm Rotate'}
              </Button>
              <Button onClick={() => onSetRotateConfirm(false)} variant="ghost" size="sm">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* New key display (shown once after rotation) */}
        {newApiKey && (
          <div className="mt-3 bg-green-500/10 border border-green-500/20 rounded-lg p-3">
            <p className="text-xs text-green-300 mb-2 font-medium">
              New API key generated. Copy it now -- it will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono bg-background border border-border rounded px-2 py-1.5 text-foreground select-all flex-1 break-all">
                {newApiKey}
              </code>
              <Button onClick={onCopyKey} variant="outline" size="sm" className="shrink-0">
                {keyCopied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <div className="mt-2">
              <Button onClick={onDismissNewKey} variant="ghost" size="xs" className="text-muted-foreground">
                Dismiss
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
