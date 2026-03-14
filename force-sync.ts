import { syncClaudeSessions } from './src/lib/claude-sessions';
import { logger } from './src/lib/logger';

async function forceSync() {
  console.log("Triggering Forensic Re-Scan...");
  const result = await syncClaudeSessions();
  console.log("Result:", result);
  process.exit(0);
}

forceSync().catch(err => {
  console.error(err);
  process.exit(1);
});
