'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface WorkspaceDoc {
  name: string
  exists: boolean
  content: string
}

interface ConfigWorkspaceSectionProps {
  editing: boolean
  identityMdInput: string
  agentMdInput: string
  savingIdentityMd: boolean
  savingAgentMd: boolean
  loadingWorkspaceDocs: boolean
  workspaceDocs: WorkspaceDoc[]
  onSaveWorkspaceFile?: (file: 'identity.md' | 'agent.md') => void
  onIdentityMdChange: (value: string) => void
  onAgentMdChange: (value: string) => void
}

export function ConfigWorkspaceSection({
  editing,
  identityMdInput,
  agentMdInput,
  savingIdentityMd,
  savingAgentMd,
  loadingWorkspaceDocs,
  workspaceDocs,
  onSaveWorkspaceFile,
  onIdentityMdChange,
  onAgentMdChange,
}: ConfigWorkspaceSectionProps) {
  const t = useTranslations('agentDetail')

  return (
    <div className="bg-surface-1/50 rounded-lg p-4 space-y-4">
      <h5 className="text-sm font-medium text-foreground">{t('workspaceFiles')}</h5>
      <p className="text-xs text-muted-foreground">{t('workspaceFilesDesc')}</p>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground font-medium">identity.md</label>
          {editing && onSaveWorkspaceFile && (
            <Button onClick={() => onSaveWorkspaceFile('identity.md')} disabled={savingIdentityMd} size="xs">
              {savingIdentityMd ? t('saving') : t('saveIdentityMd')}
            </Button>
          )}
        </div>
        {editing ? (
          <textarea
            rows={6}
            value={identityMdInput}
            onChange={(e) => onIdentityMdChange(e.target.value)}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
            placeholder="identity.md content..."
          />
        ) : (
          <pre className="bg-surface-1 rounded p-3 text-xs text-muted-foreground overflow-auto whitespace-pre-wrap min-h-[96px]">
            {identityMdInput || t('identityMdEmpty')}
          </pre>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground font-medium">agent.md</label>
          {editing && onSaveWorkspaceFile && (
            <Button onClick={() => onSaveWorkspaceFile('agent.md')} disabled={savingAgentMd} size="xs">
              {savingAgentMd ? t('saving') : t('saveAgentMd')}
            </Button>
          )}
        </div>
        {editing ? (
          <textarea
            rows={8}
            value={agentMdInput}
            onChange={(e) => onAgentMdChange(e.target.value)}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
            placeholder="agent.md content..."
          />
        ) : (
          <pre className="bg-surface-1 rounded p-3 text-xs text-muted-foreground overflow-auto whitespace-pre-wrap min-h-[120px]">
            {agentMdInput || t('agentMdEmpty')}
          </pre>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-xs text-muted-foreground font-medium">{t('otherMarkdownFiles')}</label>
        {loadingWorkspaceDocs ? (
          <div className="text-xs text-muted-foreground">{t('loadingWorkspaceFiles')}</div>
        ) : (
          <div className="space-y-2">
            {workspaceDocs
              .filter((doc) => !['identity.md', 'agent.md'].includes(doc.name))
              .map((doc) => (
                <div key={doc.name} className="bg-surface-1 rounded p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-foreground">{doc.name}</span>
                    <span className={`text-2xs ${doc.exists ? 'text-green-400' : 'text-muted-foreground'}`}>
                      {doc.exists ? t('chars', { count: doc.content.length }) : t('missing')}
                    </span>
                  </div>
                  <pre className="text-xs text-muted-foreground overflow-auto whitespace-pre-wrap max-h-32">
                    {doc.exists ? doc.content : t('fileNotFound', { name: doc.name })}
                  </pre>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
