// ---------------------------------------------------------------------------
// Task Dispatch — prompt builders for agents and Aegis reviewer
// ---------------------------------------------------------------------------
import { type DispatchableTask, type ReviewableTask } from './task-dispatch-types'

export function buildTaskPrompt(task: DispatchableTask, rejectionFeedback?: string | null): string {
  const ticket = task.ticket_prefix && task.project_ticket_no
    ? `${task.ticket_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`
    : `TASK-${task.id}`

  const lines = [
    'You have been assigned a task in Ultron Mission Control.',
    '',
    `**[${ticket}] ${task.title}**`,
    `Priority: ${task.priority}`,
  ]

  if (task.tags && task.tags.length > 0) {
    lines.push(`Tags: ${task.tags.join(', ')}`)
  }

  if (task.description) {
    lines.push('', task.description)
  }

  if (rejectionFeedback) {
    lines.push('', '## Previous Review Feedback', rejectionFeedback, '', 'Please address this feedback in your response.')
  }

  lines.push('', 'Complete this task and provide your response. Be concise and actionable.')
  return lines.join('\n')
}

export function buildReviewPrompt(task: ReviewableTask): string {
  const ticket = task.ticket_prefix && task.project_ticket_no
    ? `${task.ticket_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`
    : `TASK-${task.id}`

  const lines = [
    'You are Aegis, the quality reviewer for Ultron Mission Control.',
    'Review the following completed task and its resolution.',
    '',
    `**[${ticket}] ${task.title}**`,
  ]

  if (task.description) {
    lines.push('', '## Task Description', task.description)
  }

  if (task.resolution) {
    lines.push('', '## Agent Resolution', task.resolution.substring(0, 6000))
  }

  lines.push(
    '',
    '## Instructions',
    'Evaluate whether the agent\'s response adequately addresses the task.',
    'Respond with EXACTLY one of these two formats:',
    '',
    'If the work is acceptable:',
    'VERDICT: APPROVED',
    'NOTES: <brief summary of why it passes>',
    '',
    'If the work needs improvement:',
    'VERDICT: REJECTED',
    'NOTES: <specific issues that need to be fixed>',
  )

  return lines.join('\n')
}
