// Shared formatting helpers for the Cost Tracker panel

export const COLORS = [
  '#0088FE', '#00C49F', '#FFBB28', '#FF8042',
  '#8884d8', '#82ca9d', '#ffc658', '#ff6b6b',
]

export const formatNumber = (num: number): string => {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K'
  return num.toString()
}

export const formatCost = (cost: number): string => '$' + cost.toFixed(4)

export const getModelDisplayName = (name: string): string =>
  name.split('/').pop() || name
