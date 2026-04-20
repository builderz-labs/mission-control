'use client'

import { DmShell, Card, Pill } from './shell'
import { VAULT_TABLES } from '@/lib/darkmada/mock'

export function TheVault() {
  return (
    <DmShell
      eyebrow="The Vault · Source of truth"
      title="Supabase spine"
      subtitle="The canonical store. Every other surface in the system mirrors or projects from here."
    >
      <Card eyebrow="Tables" title="Truth-source registry" accent="cyan">
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card/60">
              <tr className="text-left">
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Table</th>
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Purpose</th>
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Storage</th>
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Truth</th>
              </tr>
            </thead>
            <tbody>
              {VAULT_TABLES.map((t) => (
                <tr key={t.name} className="border-t border-border/50">
                  <td className="px-4 py-3 font-mono text-void-cyan text-xs">{t.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.purpose}</td>
                  <td className="px-4 py-3"><Pill accent={t.vectorized ? 'violet' : 'muted'}>{t.vectorized ? 'pgvector' : 'relational'}</Pill></td>
                  <td className="px-4 py-3"><Pill accent={t.truthSource ? 'cyan' : 'muted'}>{t.truthSource ? 'canonical' : 'derived'}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card eyebrow="Boundary" title="Secrets ownership" accent="crimson">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Secrets live in the Jackson account's keychain only. The Tool Access MCP brokers per-call access with a
            short-lived signed token. No agent process ever sees a raw secret.
          </p>
        </Card>
        <Card eyebrow="Boundary" title="Backup posture" accent="amber">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Postgres is snapshotted nightly to encrypted off-host storage. Audit logs are append-only and replicated
            independently. Restore drills are scheduled monthly.
          </p>
        </Card>
      </div>
    </DmShell>
  )
}
