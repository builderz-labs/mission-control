import { getProjectHealth } from './src/lib/project-tracker';
import fs from 'fs';

const projectName = 'maestro';
const health = getProjectHealth(projectName);

console.log(`Health for ${projectName}:`);
console.log(`Progress: ${health.progress}%`);
console.log(`Roadmap Focus: ${health.roadmapFocus}`);
console.log(`Current Phase: ${health.currentPhase}`);
console.log(`Roadmap Phases: ${health.roadmap?.length || 0}`);

if (health.roadmap) {
  health.roadmap.forEach(phase => {
    console.log(`Phase: ${phase.name} [${phase.status}] ${phase.progress}%`);
    phase.tasks.slice(0, 3).forEach(task => {
      console.log(`  - ${task.name} [${task.status}] indent: ${task.indent}`);
    });
  });
}
