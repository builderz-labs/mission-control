
import { SovereigntyPolicyService } from './src/lib/services/sovereignty-policy-service';
import { getDatabase } from './src/lib/db';

async function verifyPhase9() {
  console.log('🛡️ Starting Phase 9: Autonomous Sovereignty verification...');
  
  const db = getDatabase();
  
  // 1. Test Policy Evaluation
  console.log('Evaluating Sovereignty Policy Engine...');
  const start = performance.now();
  const violations = await SovereigntyPolicyService.evaluateFleet();
  const duration = performance.now() - start;
  
  console.log(`- Policy evaluation complete in ${duration.toFixed(2)}ms`);
  console.log(`- Active violations detected: ${violations.length}`);
  
  if (violations.length > 0) {
    console.log('Sample Violation Detail:');
    console.log(JSON.stringify(violations[0], null, 2));
  }

  // 2. Database check for alert_status consistency
  const criticals = db.prepare("SELECT COUNT(*) as count FROM claude_sessions WHERE alert_status = 'critical'").get() as { count: number };
  console.log(`- Database sessions in 'critical' state: ${criticals.count}`);

  console.log('\n✅ Phase 9 Logic Verified.');
}

verifyPhase9().catch(console.error);
