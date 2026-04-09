'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { TEMPLATES, MODEL_TIER_COLORS, MODEL_TIER_LABELS } from './agent-detail-utils'

interface StepTemplateProps {
  selectedTemplate: string | null
  onSelect: (type: string | null) => void
}

export function StepTemplate({ selectedTemplate, onSelect }: StepTemplateProps): React.ReactElement {
  const t = useTranslations('agentDetail')

  return (
    <div className="grid grid-cols-2 gap-3">
      {TEMPLATES.map(tmpl => (
        <Button
          key={tmpl.type}
          onClick={() => onSelect(tmpl.type)}
          variant="outline"
          className={`p-4 h-auto text-left flex flex-col items-start ${
            selectedTemplate === tmpl.type ? 'border-primary bg-primary/5' : ''
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{tmpl.emoji}</span>
            <span className="font-semibold text-foreground">{tmpl.label}</span>
          </div>
          <p className="text-xs text-muted-foreground mb-2">{tmpl.description}</p>
          <div className="flex gap-2">
            <span className={`px-2 py-0.5 text-xs rounded border ${MODEL_TIER_COLORS[tmpl.modelTier]}`}>
              {MODEL_TIER_LABELS[tmpl.modelTier]}
            </span>
            <span className="px-2 py-0.5 text-xs rounded bg-surface-2 text-muted-foreground">
              {t('toolCount', { count: tmpl.toolCount })}
            </span>
          </div>
        </Button>
      ))}
      {/* Custom option */}
      <Button
        onClick={() => onSelect(null)}
        variant="outline"
        className={`p-4 h-auto text-left flex flex-col items-start border-dashed ${
          selectedTemplate === null ? 'border-primary' : ''
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">+</span>
          <span className="font-semibold text-foreground">Custom</span>
        </div>
        <p className="text-xs text-muted-foreground">{t('customDesc')}</p>
      </Button>
    </div>
  )
}
