const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const task = process.argv.slice(2).join(' ').trim();
if (!task) {
  console.error('[CrewAI Bridge] Missing task argument.');
  process.exit(1);
}

const orchestratorRoot = __dirname;
const missionControlRoot = path.resolve(orchestratorRoot, '..');
const crewProjectRoot = path.resolve(missionControlRoot, 'crewAI', 'mission_control_orchestrator');
const outputDir = path.resolve(orchestratorRoot, 'output');

fs.mkdirSync(outputDir, { recursive: true });

const args = [
  'run',
  '--project',
  crewProjectRoot,
  '-m',
  'mission_control_orchestrator.main',
  '--task',
  task,
  '--workspace-root',
  missionControlRoot,
  '--output-dir',
  outputDir,
  '--project-name',
  'mission-control',
];

if (String(process.env.MC_CREW_DRY_RUN || '').toLowerCase() === 'true') {
  args.push('--dry-run');
}

console.log('[CrewAI Bridge] Launching Mission Control crew orchestrator...');
console.log(`[CrewAI Bridge] Project: ${crewProjectRoot}`);

const child = spawn('uv', args, {
  cwd: crewProjectRoot,
  env: {
    ...process.env,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  },
  stdio: 'inherit',
  shell: false,
});

child.on('error', (error) => {
  console.error(`[CrewAI Bridge] Failed to start uv: ${error.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 1);
});
