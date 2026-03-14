import { generateMissionDebrief } from './src/lib/services/mission-debrief-service';
import { getDatabase } from './src/lib/db';
import { performance } from 'perf_hooks';

async function verifyPhase8() {
  console.log('--- PHASE 8 VERIFICATION PROTOCOL ---');
  
  const db = getDatabase();
  const session = db.prepare('SELECT session_id FROM claude_sessions LIMIT 1').get() as { session_id: string } | undefined;

  if (!session) {
    console.error('FAILED: No sessions found in database.');
    process.exit(1);
  }

  console.log(`SESSION DETECTED: ${session.session_id}`);

  // Test 1: Debrief Performance
  const start = performance.now();
  const debrief = await generateMissionDebrief(session.session_id);
  const end = performance.now();
  const duration = end - start;

  if (debrief) {
    console.log(`SUCCESS: Mission Debrief generated in ${duration.toFixed(2)}ms`);
    console.log('CONTENT PREVIEW:');
    console.log(debrief.markdown.slice(0, 300) + '...');
  } else {
    console.error('FAILED: Mission Debrief generation returned null.');
  }

  // Test 2: Intent Detection Check
  const intentCheck = db.prepare('SELECT session_id, intent_task FROM claude_sessions WHERE intent_task IS NOT NULL LIMIT 5').all() as any[];
  console.log(`INTENT DETECTION: Found ${intentCheck.length} sessions with captured intent.`);
  intentCheck.forEach(s => {
    console.log(`- Session ${s.session_id}: ${s.intent_task}`);
  });

  process.exit(0);
}

verifyPhase8().catch(err => {
  console.error(err);
  process.exit(1);
});
