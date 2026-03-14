import { syncClaudeSessions } from './src/lib/claude-sessions';
import { syncGitHealth, trackAllProjects } from './src/lib/project-tracker';
import { logger } from './src/lib/logger';

async function verify() {
  console.log('--- Phase 1: Claude Session Sync ---');
  const claudeResult = await syncClaudeSessions();
  console.log('Result:', claudeResult);

  console.log('\n--- Phase 2: Git Health Sync ---');
  await syncGitHealth();
  console.log('Git health sync completed.');

  console.log('\n--- Phase 3: Project Health Overview ---');
  const projects = trackAllProjects();
  projects.forEach(p => {
    console.log(`- Project: ${p.name}`);
    console.log(`  Progress: ${p.progress}%`);
    if (p.git) {
      console.log(`  Git: ${p.git.branch} [${p.git.isDirty ? 'DIRTY' : 'CLEAN'}]`);
      console.log(`  Commits: ${p.git.commitHash?.slice(0,7)}`);
    } else {
      console.log('  Git: No repo found');
    }
  });
}

verify().catch(console.error);
