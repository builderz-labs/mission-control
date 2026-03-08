export function computePriorityScore(urgency: number, dueDate: number | null): number {
  const now = Math.floor(Date.now() / 1000)
  const urgencyScore = urgency * 20
  if (!dueDate) return urgencyScore
  const daysUntilDue = (dueDate - now) / 86400
  if (daysUntilDue < 0) return urgencyScore + 100 // overdue
  return urgencyScore + Math.max(0, 30 - daysUntilDue) * 2
}
