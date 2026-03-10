// src/team-memory.js
// Stores what each team member learned across task cycles.

const memory = {
  ChatGPT: [],
  Gemini: [],
  Kimi: [],
  Kilo: [],
  AmazonQ: [],
  Groq: [],
  Ollama: [],
  UIDesigner: [],
  TechLead: [],
};

/**
 * Record a learning entry for a team member.
 * @param {string} member - Team member name
 * @param {string} taskId - Task identifier
 * @param {string} learned - What was learned
 */
function remember(member, taskId, learned) {
  if (!memory[member]) memory[member] = [];
  memory[member].push({
    taskId,
    learned,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Retrieve all learnings for a team member.
 * @param {string} member - Team member name
 * @returns {Array}
 */
function recall(member) {
  return memory[member] || [];
}

/**
 * Print a full team learning summary to console.
 */
function printSummary() {
  console.log('\n── TEAM LEARNING SUMMARY ──────────────────────────');
  for (const [member, entries] of Object.entries(memory)) {
    if (entries.length === 0) continue;
    console.log(`\n  ${member}:`);
    entries.forEach((e) =>
      console.log(`    [${e.taskId}] ${e.learned}`)
    );
  }
  console.log('────────────────────────────────────────────────────\n');
}

module.exports = { remember, recall, printSummary };
