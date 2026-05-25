'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import type * as RechartsNS from 'recharts'

interface ToolAuditEntry {
  tool: string; calls: number; successes: number; failures: number
}
interface TimelinePoint {
  timestamp: string; authEvents: number; injectionAttempts: number; secretAlerts: number; toolCalls: number
}

function useRecharts() {
  const [mod, setMod] = useState<typeof RechartsNS | null>(null)
  useEffect(() => { import('recharts').then(m => setMod(m as typeof RechartsNS)) }, [])
  return mod
}

export function ToolAuditChart({ data }: { data: ToolAuditEntry[] }) {
  const t = useTranslations('SecurityAuditPanel')
  const recharts = useRecharts()
  if (!recharts) return null
  const { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } = recharts
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="tool" angle={-45} textAnchor="end" height={60} interval={0} tick={{ fontSize: 10 }} />
        <YAxis />
        <Tooltip />
        <Legend />
        <Bar dataKey="successes" stackId="a" fill="#22c55e" name={t('chartSuccess')} />
        <Bar dataKey="failures" stackId="a" fill="#ef4444" name={t('chartFailure')} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function SecurityTimelineChart({ data }: { data: TimelinePoint[] }) {
  const t = useTranslations('SecurityAuditPanel')
  const recharts = useRecharts()
  const transformed = data.map(p => ({
    ...p,
    time: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }))
  if (!recharts) return null
  const { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } = recharts
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={transformed}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="time" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="authEvents" stroke="#8884d8" strokeWidth={2} name={t('chartAuthEvents')} />
        <Line type="monotone" dataKey="injectionAttempts" stroke="#ef4444" strokeWidth={2} name={t('chartInjections')} />
        <Line type="monotone" dataKey="secretAlerts" stroke="#f59e0b" strokeWidth={2} name={t('chartSecrets')} />
        <Line type="monotone" dataKey="toolCalls" stroke="#22c55e" strokeWidth={2} name={t('chartToolCalls')} />
      </LineChart>
    </ResponsiveContainer>
  )
}
