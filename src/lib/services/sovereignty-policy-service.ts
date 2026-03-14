import { getDatabase } from '../db';
import { logger } from '../logger';

export interface PolicyViolation {
  sessionId: string;
  type: 'COST_EXCEEDED' | 'TOOL_LOOP' | 'VELOCITY_SPIKE';
  severity: 'warning' | 'critical';
  message: string;
  timestamp: string;
}

export interface PolicyConfig {
  maxSessionCost: number;     // USD
  maxToolRepeats: number;    // Count
  velocityThreshold: number; // Tokens per second
}

const DEFAULT_POLICY: PolicyConfig = {
  maxSessionCost: 20.00,
  maxToolRepeats: 5,
  velocityThreshold: 500,
};

export class SovereigntyPolicyService {
  /**
   * Evaluates all active sessions against the defined sovereignty policies.
   * Returns a list of violations.
   */
  static async evaluateFleet(): Promise<PolicyViolation[]> {
    const db = getDatabase();
    const activeSessions = db.prepare('SELECT * FROM claude_sessions WHERE is_active = 1').all() as any[];
    const violations: PolicyViolation[] = [];

    for (const session of activeSessions) {
      // 1. Cost Policy
      if (session.estimated_cost > DEFAULT_POLICY.maxSessionCost) {
        violations.push({
          sessionId: session.session_id,
          type: 'COST_EXCEEDED',
          severity: 'critical',
          message: `Session cost ($${session.estimated_cost}) exceeds sovereignty limit ($${DEFAULT_POLICY.maxSessionCost})`,
          timestamp: new Date().toISOString(),
        });
      }

      // 2. Tool Loop Detection
      const timeline = JSON.parse(session.tool_timeline || '[]');
      if (timeline.length >= DEFAULT_POLICY.maxToolRepeats) {
        const lastN = timeline.slice(-DEFAULT_POLICY.maxToolRepeats);
        const allSame = lastN.every((t: any) => t.name === lastN[0].name);
        if (allSame) {
          violations.push({
            sessionId: session.session_id,
            type: 'TOOL_LOOP',
            severity: 'warning',
            message: `Predictive alert: Detected tool loop (${lastN[0].name}) across ${DEFAULT_POLICY.maxToolRepeats} iterations.`,
            timestamp: new Date().toISOString(),
          });
        }
      }

      // 3. Velocity Checks (Simplified for now based on total tokens / duration)
      const firstAt = new Date(session.first_message_at).getTime();
      const lastAt = new Date(session.last_message_at).getTime();
      const durationSec = (lastAt - firstAt) / 1000;
      if (durationSec > 10) {
        const velocity = (session.input_tokens + session.output_tokens) / durationSec;
        if (velocity > DEFAULT_POLICY.velocityThreshold) {
          violations.push({
            sessionId: session.session_id,
            type: 'VELOCITY_SPIKE',
            severity: 'warning',
            message: `Token velocity (${Math.round(velocity)} t/s) exceeds safety threshold.`,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    if (violations.length > 0) {
      logger.info({ violationCount: violations.length }, 'Sovereignty policy breaches detected');
    }

    return violations;
  }
}
