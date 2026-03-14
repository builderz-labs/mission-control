import { Session } from '@/types'

export type RemediationAction = 'ROLLBACK' | 'HANDOFF' | 'FORCE_SYNC' | 'RESCAN' | 'NONE'

export interface RemediationStrategy {
  action: RemediationAction
  priority: 'low' | 'medium' | 'high'
  rationale: string
  metadata?: Record<string, any>
}

/**
 * Derives a remediation strategy based on session performance and anomaly status.
 */
export function getRemediationSuggestion(session: Session): RemediationStrategy {
  const stability = session.stability_score ?? 100
  const isAnomaly = session.is_anomaly ?? false
  const errorCount = session.tool_error_count ?? 0
  
  // 1. Critical Anomaly Case: High Error Density or Stability Crash
  if (isAnomaly && stability < 50) {
    return {
      action: 'ROLLBACK',
      priority: 'high',
      rationale: `Session stability has crashed to ${Math.round(stability)}% with ${errorCount} errors. Immediate branch rollback suggested to prevent further corruption.`
    }
  }

  // 2. Medium Risk: Frequent Tool Errors without a full "Anomaly" pulse
  if (errorCount > 5 && stability < 75) {
    return {
      action: 'HANDOFF',
      priority: 'medium',
      rationale: `Agent is struggling with tool execution (${errorCount} errors). Suggesting handoff to a specialized sub-agent or human review.`
    }
  }

  // 3. Sync Issues: Stale session with high activity but no recent progress
  if (session.is_active && session.total_loc_delta === 0 && (session.user_messages ?? 0) > 10) {
    return {
      action: 'FORCE_SYNC',
      priority: 'medium',
      rationale: 'Active session with high message volume but 0 LoC impact. Potential desync between agent state and project files.'
    }
  }

  // 4. Nominal case
  return {
    action: 'NONE',
    priority: 'low',
    rationale: 'Session behavior is within project baselines.'
  }
}
