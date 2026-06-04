'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { apiFetch } from '@/lib/api-client'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface MoneyAmount {
  cents: number
  amount: number
  currency: string
}

interface RevenuePeriod {
  gross: MoneyAmount
  net: MoneyAmount
  transactionCount: number
}

interface StripeRevenueAccountSummary {
  id: string
  name: string
  currency: string
  today: RevenuePeriod
  yesterday: RevenuePeriod
  monthToDate: RevenuePeriod
  yearToDate: RevenuePeriod
  mrr: MoneyAmount
  arr: MoneyAmount
  subscriptionCount: number
  status: 'ok' | 'error'
  error?: string
}

interface StripeRevenueSnapshot {
  generatedAt: string
  configured: boolean
  accounts: StripeRevenueAccountSummary[]
  totals: Omit<StripeRevenueAccountSummary, 'id' | 'name' | 'status' | 'error'>
  setupHint?: string
}

function formatMoney(value?: MoneyAmount): string {
  if (!value) return '-'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: value.currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(value.amount)
}

function formatExactMoney(value?: MoneyAmount): string {
  if (!value) return '-'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: value.currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(value.amount)
}

function formatGeneratedAt(value?: string): string {
  if (!value) return 'never'
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function MetricCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
      {sublabel && <div className="mt-1 text-xs text-muted-foreground">{sublabel}</div>}
    </div>
  )
}

function ValuePair({ gross, net }: { gross: MoneyAmount; net: MoneyAmount }) {
  return (
    <div className="space-y-1">
      <div className="font-medium text-foreground">{formatExactMoney(gross)}</div>
      <div className="text-xs text-muted-foreground">net {formatExactMoney(net)}</div>
    </div>
  )
}

export function StripeRevenuePanel() {
  const [snapshot, setSnapshot] = useState<StripeRevenueSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSnapshot = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<StripeRevenueSnapshot>('/api/stripe-revenue', { cache: 'no-store' })
      setSnapshot(data)
    } catch (err: any) {
      setError(err?.message || 'Failed to load Stripe revenue')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSnapshot()
  }, [loadSnapshot])

  const chartData = useMemo(() => {
    return (snapshot?.accounts || [])
      .filter(account => account.status === 'ok')
      .map(account => ({
        name: account.name.length > 18 ? `${account.name.slice(0, 17)}...` : account.name,
        Today: account.today.net.amount,
        Yesterday: account.yesterday.net.amount,
        MTD: account.monthToDate.net.amount,
      }))
  }, [snapshot?.accounts])

  if (loading && !snapshot) {
    return <Loader variant="panel" label="Loading Stripe revenue..." />
  }

  const totals = snapshot?.totals
  const okAccounts = snapshot?.accounts.filter(account => account.status === 'ok').length || 0

  return (
    <div className="min-h-full bg-background p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Stripe revenue</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {okAccounts} connected account{okAccounts === 1 ? '' : 's'} refreshed {formatGeneratedAt(snapshot?.generatedAt)}
            </p>
          </div>
          <Button size="sm" onClick={loadSnapshot} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {snapshot && !snapshot.configured ? (
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-base font-medium text-foreground">No Stripe accounts configured</h2>
            <p className="mt-2 text-sm text-muted-foreground">{snapshot.setupHint}</p>
          </div>
        ) : totals ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
              <MetricCard label="Today gross" value={formatMoney(totals.today.gross)} />
              <MetricCard label="Today net" value={formatMoney(totals.today.net)} />
              <MetricCard label="Yesterday gross" value={formatMoney(totals.yesterday.gross)} />
              <MetricCard label="Yesterday net" value={formatMoney(totals.yesterday.net)} />
              <MetricCard label="MTD gross" value={formatMoney(totals.monthToDate.gross)} />
              <MetricCard label="MTD net" value={formatMoney(totals.monthToDate.net)} />
              <MetricCard label="MRR" value={formatMoney(totals.mrr)} sublabel={`${totals.subscriptionCount} subscriptions`} />
              <MetricCard label="ARR" value={formatMoney(totals.arr)} />
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-medium text-foreground">Net revenue by account</h2>
                <span className="text-xs text-muted-foreground">Today, yesterday, month to date</span>
              </div>
              <div className="h-72">
                {chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No Stripe revenue data returned yet.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value) => formatExactMoney({ amount: Number(value), cents: Math.round(Number(value) * 100), currency: totals.currency })} />
                      <Bar dataKey="Today" fill="#22c55e" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Yesterday" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="MTD" fill="#a78bfa" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-base font-medium text-foreground">Accounts</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Account</th>
                      <th className="px-4 py-3 text-left font-medium">Today</th>
                      <th className="px-4 py-3 text-left font-medium">Yesterday</th>
                      <th className="px-4 py-3 text-left font-medium">Month to date</th>
                      <th className="px-4 py-3 text-left font-medium">Year to date</th>
                      <th className="px-4 py-3 text-left font-medium">MRR</th>
                      <th className="px-4 py-3 text-left font-medium">ARR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.accounts.map(account => (
                      <tr key={account.id} className="border-t border-border/70">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{account.name}</div>
                          <div className={account.status === 'ok' ? 'text-xs text-muted-foreground' : 'text-xs text-red-300'}>
                            {account.status === 'ok' ? account.currency.toUpperCase() : account.error}
                          </div>
                        </td>
                        <td className="px-4 py-3"><ValuePair gross={account.today.gross} net={account.today.net} /></td>
                        <td className="px-4 py-3"><ValuePair gross={account.yesterday.gross} net={account.yesterday.net} /></td>
                        <td className="px-4 py-3"><ValuePair gross={account.monthToDate.gross} net={account.monthToDate.net} /></td>
                        <td className="px-4 py-3"><ValuePair gross={account.yearToDate.gross} net={account.yearToDate.net} /></td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{formatExactMoney(account.mrr)}</div>
                          <div className="text-xs text-muted-foreground">{account.subscriptionCount} subscriptions</div>
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">{formatExactMoney(account.arr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
