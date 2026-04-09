'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface ConfigToolsSectionProps {
  editing: boolean
  toolAllow: string[]
  toolDeny: string[]
  toolRawPreview: string
  newAllowTool: string
  newDenyTool: string
  onNewAllowChange: (value: string) => void
  onNewDenyChange: (value: string) => void
  onAddTool: (list: 'allow' | 'deny', value: string) => void
  onRemoveTool: (list: 'allow' | 'deny', index: number) => void
}

export function ConfigToolsSection({
  editing,
  toolAllow,
  toolDeny,
  toolRawPreview,
  newAllowTool,
  newDenyTool,
  onNewAllowChange,
  onNewDenyChange,
  onAddTool,
  onRemoveTool,
}: ConfigToolsSectionProps): React.ReactElement {
  const t = useTranslations('agentDetail')

  return (
    <div className="bg-surface-1/50 rounded-lg p-4">
      <h5 className="text-sm font-medium text-foreground mb-2">{t('tools')}</h5>
      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-green-400 font-medium mb-1">{t('allowList')}</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {toolAllow.map((tool: string, i: number) => (
                <span key={`${tool}-${i}`} className="px-2 py-0.5 text-xs bg-green-500/10 text-green-400 rounded border border-green-500/20 flex items-center gap-1">
                  {tool}
                  <Button
                    onClick={() => onRemoveTool('allow', i)}
                    variant="ghost"
                    size="icon-xs"
                    className="text-green-400/60 hover:text-green-400 ml-1 h-auto w-auto p-0"
                  >
                    &times;
                  </Button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newAllowTool}
                onChange={(e) => onNewAllowChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onAddTool('allow', newAllowTool)
                    onNewAllowChange('')
                  }
                }}
                placeholder={t('addAllowedTool')}
                className="flex-1 bg-surface-1 text-foreground rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <Button
                onClick={() => { onAddTool('allow', newAllowTool); onNewAllowChange('') }}
                variant="outline"
                size="sm"
                className="bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30"
              >
                {t('add')}
              </Button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-red-400 font-medium mb-1">{t('denyList')}</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {toolDeny.map((tool: string, i: number) => (
                <span key={`${tool}-${i}`} className="px-2 py-0.5 text-xs bg-red-500/10 text-red-400 rounded border border-red-500/20 flex items-center gap-1">
                  {tool}
                  <Button
                    onClick={() => onRemoveTool('deny', i)}
                    variant="ghost"
                    size="icon-xs"
                    className="text-red-400/60 hover:text-red-400 ml-1 h-auto w-auto p-0"
                  >
                    &times;
                  </Button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newDenyTool}
                onChange={(e) => onNewDenyChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onAddTool('deny', newDenyTool)
                    onNewDenyChange('')
                  }
                }}
                placeholder={t('addDeniedTool')}
                className="flex-1 bg-surface-1 text-foreground rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <Button
                onClick={() => { onAddTool('deny', newDenyTool); onNewDenyChange('') }}
                variant="outline"
                size="sm"
                className="bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
              >
                {t('add')}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {toolAllow.length > 0 && (
            <div className="mb-2">
              <span className="text-xs text-green-400 font-medium">{t('allowCount', { count: toolAllow.length })}:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {toolAllow.map((tool: string) => (
                  <span key={tool} className="px-2 py-0.5 text-xs bg-green-500/10 text-green-400 rounded border border-green-500/20">{tool}</span>
                ))}
              </div>
            </div>
          )}
          {toolDeny.length > 0 && (
            <div>
              <span className="text-xs text-red-400 font-medium">{t('denyCount', { count: toolDeny.length })}:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {toolDeny.map((tool: string) => (
                  <span key={tool} className="px-2 py-0.5 text-xs bg-red-500/10 text-red-400 rounded border border-red-500/20">{tool}</span>
                ))}
              </div>
            </div>
          )}
          {toolAllow.length === 0 && toolDeny.length === 0 && !toolRawPreview && (
            <div className="text-xs text-muted-foreground">{t('noToolsConfigured')}</div>
          )}
          {toolRawPreview && (
            <pre className="mt-3 text-xs text-muted-foreground bg-surface-1 rounded p-2 overflow-auto whitespace-pre-wrap">
              {toolRawPreview}
            </pre>
          )}
        </>
      )}
    </div>
  )
}
