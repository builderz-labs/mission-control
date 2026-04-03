// Constants for Token Dashboard — chart colors, timezone options

import type { TimezoneOption } from './types'

export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { label: 'Local', offset: NaN },
  { label: 'UTC', offset: 0 },
  { label: 'UTC-8 (PST)', offset: -8 },
  { label: 'UTC-7 (MST)', offset: -7 },
  { label: 'UTC-6 (CST)', offset: -6 },
  { label: 'UTC-5 (EST)', offset: -5 },
  { label: 'UTC+1 (CET)', offset: 1 },
  { label: 'UTC+5:30 (IST)', offset: 5.5 },
  { label: 'UTC+8 (CST)', offset: 8 },
  { label: 'UTC+9 (JST)', offset: 9 },
]

export const CHART_COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d']

export const PROVIDER_COLORS: Record<string, string> = {
  Anthropic: '#d97706',
  OpenAI: '#10b981',
  Google: '#3b82f6',
  Mistral: '#f97316',
  Meta: '#6366f1',
  DeepSeek: '#06b6d4',
  Cohere: '#ec4899',
  Other: '#6b7280',
}
