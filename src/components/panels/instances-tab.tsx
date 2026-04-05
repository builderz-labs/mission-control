'use client'

import { useTranslations } from 'next-intl'
import { relativeTime, statusColor } from './nodes-panel-utils'
import type { PresenceEntry } from './nodes-panel-types'

interface InstancesTabProps {
  readonly nodes: PresenceEntry[]
}

export function InstancesTab({ nodes }: InstancesTabProps): React.ReactElement {
  const t = useTranslations('nodes')

  if (nodes.length === 0) {
    return (
      <div className="text-muted-foreground text-sm py-8 text-center">
        {t('noInstances')}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">{t('colName')}</th>
            <th className="pb-2 pr-4 font-medium">{t('colClientId')}</th>
            <th className="pb-2 pr-4 font-medium">{t('colPlatform')}</th>
            <th className="pb-2 pr-4 font-medium">{t('colVersion')}</th>
            <th className="pb-2 pr-4 font-medium">{t('colRoles')}</th>
            <th className="pb-2 pr-4 font-medium">{t('colStatus')}</th>
            <th className="pb-2 pr-4 font-medium">{t('colConnected')}</th>
            <th className="pb-2 pr-4 font-medium">{t('colLastActivity')}</th>
            <th className="pb-2 font-medium">{t('colHostIp')}</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <InstanceRow key={node.id} node={node} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface InstanceRowProps {
  readonly node: PresenceEntry
}

function InstanceRow({ node }: InstanceRowProps): React.ReactElement {
  const t = useTranslations('nodes')
  return (
    <tr className="border-b border-border/50">
      <td className="py-2 pr-4 text-foreground font-medium">{node.displayName}</td>
      <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">
        {node.clientId?.slice(0, 12)}...
      </td>
      <td className="py-2 pr-4 text-muted-foreground">{node.platform}</td>
      <td className="py-2 pr-4 text-muted-foreground">{node.version}</td>
      <td className="py-2 pr-4">
        <div className="flex gap-1 flex-wrap">
          {(node.roles || []).map((role) => (
            <span
              key={role}
              className="px-1.5 py-0.5 rounded text-xs bg-secondary text-muted-foreground"
            >
              {role}
            </span>
          ))}
        </div>
      </td>
      <td className="py-2 pr-4">
        <span
          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${statusColor(node.status)}`}
        >
          {node.status}
        </span>
      </td>
      <td className="py-2 pr-4 text-muted-foreground text-xs">
        {relativeTime(node.connectedAt)}
      </td>
      <td className="py-2 pr-4 text-muted-foreground text-xs">
        {relativeTime(node.lastActivity)}
      </td>
      <td className="py-2 text-muted-foreground text-xs font-mono">
        {node.host ?? node.ip ?? '--'}
      </td>
    </tr>
  )
}
