'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { Agent } from './orchestration-bar.types'

interface CommandTabProps {
  agents: Agent[]
  selectedAgent: string
  onSelectAgent: (value: string) => void
  message: string
  onMessageChange: (value: string) => void
  onSend: () => void
  sending: boolean
}

export function CommandTab({
  agents,
  selectedAgent,
  onSelectAgent,
  message,
  onMessageChange,
  onSend,
  sending,
}: CommandTabProps): React.ReactElement {
  const t = useTranslations('orchestration')

  return (
    <div className="p-4 pt-3">
      <div className="flex gap-2">
        <select
          value={selectedAgent}
          onChange={(e) => onSelectAgent(e.target.value)}
          className="h-9 px-2 rounded-md bg-secondary border border-border text-sm text-foreground min-w-[140px]"
        >
          <option value="">{t('selectAgent')}</option>
          {agents.length === 0 && (
            <option value="" disabled>{t('noAgentsRegistered')}</option>
          )}
          {agents.map(a => (
            <option
              key={a.name}
              value={a.name}
              disabled={!a.session_key}
              title={!a.session_key ? 'Agent has no active session' : undefined}
            >
              {a.name} ({a.status}){!a.session_key ? ` — ${t('noSessionSuffix')}` : ''}
            </option>
          ))}
        </select>
        <input
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSend()}
          placeholder={t('commandPlaceholder')}
          className="flex-1 h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground"
        />
        <Button
          onClick={onSend}
          disabled={!selectedAgent || !message.trim() || sending}
        >
          {sending ? '...' : t('send')}
        </Button>
      </div>
    </div>
  )
}
