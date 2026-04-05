// WHY: Export logic is pure (no React), so it belongs outside the component tree
import { downloadText } from '@/lib/download'
import type { StandupReport } from './standup-types'
import { formatDisplayDate } from './standup-types'

function buildExportLines(report: StandupReport): string[] {
  const lines: string[] = [
    `# Daily Standup - ${formatDisplayDate(report.date)}`,
    `Generated: ${new Date(report.generatedAt).toLocaleString()}`,
    '',
    '## Summary',
    `- **Agents Active:** ${report.summary.totalAgents}`,
    `- **Completed Today:** ${report.summary.totalCompleted}`,
    `- **In Progress:** ${report.summary.totalInProgress}`,
    `- **Assigned:** ${report.summary.totalAssigned}`,
    `- **In Review:** ${report.summary.totalReview}`,
    `- **Blocked:** ${report.summary.totalBlocked}`,
    `- **Overdue:** ${report.summary.overdue}`,
    '',
  ]

  if (report.teamAccomplishments.length > 0) {
    lines.push('## Team Accomplishments')
    report.teamAccomplishments.forEach(task => {
      lines.push(`- **${task.agent}**: ${task.title}`)
    })
    lines.push('')
  }

  if (report.teamBlockers.length > 0) {
    lines.push('## Team Blockers')
    report.teamBlockers.forEach(task => {
      lines.push(`- **${task.agent}** [${task.priority.toUpperCase()}]: ${task.title}`)
    })
    lines.push('')
  }

  lines.push('## Individual Reports')
  report.agentReports.forEach(agentReport => {
    lines.push(`### ${agentReport.agent.name} (${agentReport.agent.role})`)

    if (agentReport.completedToday.length > 0) {
      lines.push('**Completed Today:**')
      agentReport.completedToday.forEach(task => lines.push(`- ${task.title}`))
    }

    if (agentReport.inProgress.length > 0) {
      lines.push('**In Progress:**')
      agentReport.inProgress.forEach(task => lines.push(`- ${task.title}`))
    }

    if (agentReport.blocked.length > 0) {
      lines.push('**Blocked:**')
      agentReport.blocked.forEach(task => {
        lines.push(`- [${task.priority.toUpperCase()}] ${task.title}`)
      })
    }

    lines.push('')
  })

  return lines
}

export function exportStandupReport(report: StandupReport): void {
  const text = buildExportLines(report).join('\n')
  downloadText(text, `standup-${report.date}.md`, 'text/markdown')
}
