// src/orchestrator.js
// Tech Lead orchestrator — Groge decomposes tasks and routes them to team members.

const fs = require('fs');
const path = require('path');
const { jsonrepair } = require('jsonrepair');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { routeTask, detectAssignee } = require('./task-router');
const { remember, printSummary } = require('./team-memory');
const { resolveGeminiModel } = require('./gemini-models');

const anthropic = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Groq Tech Lead — free, fast, OpenAI-compatible
const groqTechLead = process.env.GROQ_API_KEY
  ? new OpenAI.default({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    })
  : null;

// Counter for generating unique task IDs
let taskCounter = 1;
function nextTaskId() {
  return `TASK-${String(taskCounter++).padStart(3, '0')}`;
}

/**
 * Tech Lead (Groge) decomposes a feature request into structured tasks.
 * @param {string} featureRequest - Natural language description of the feature
 * @returns {Promise<object>} Parsed task breakdown JSON
 */
async function decompose(featureRequest) {
  console.log('\n[TechLead] Analyzing feature request...');

  const systemPrompt = `You are Groge, the Tech Lead of a multi-AI development team.
Team members: ChatGPT (Full Stack), Gemini (Research/Docs), Kimi (Backend/Long Docs), Kilo (DevOps), AmazonQ (AWS/Security), UIDesigner (UI/UX Design, HTML/CSS/Tailwind, wireframes, responsive layouts).

When given a feature request, respond with ONLY valid JSON in this exact format:
{
  "feature": "<feature name>",
  "architecture_decision": "<your recommendation>",
  "tasks": [
    {
      "task_id": "<TASK-001>",
      "assigned_to": "<ChatGPT|Gemini|Kimi|Kilo|AmazonQ|UIDesigner>",
      "task": "<specific instruction>",
      "input": "<what this AI needs>",
      "expected_output": "<what you expect back>",
      "depends_on": []
    }
  ],
  "integration_notes": "<how to combine outputs>",
  "review_checklist": ["<item1>", "<item2>"]
}
No extra text. Only JSON.`;

  const providers = buildTechLeadProviderOrder();
  const errors = [];

  for (const provider of providers) {
    try {
      switch (provider) {
        case 'claude':
          return await decomposeWithClaude(systemPrompt, featureRequest);
        case 'openai':
          return await decomposeWithOpenAI(systemPrompt, featureRequest);
        case 'gemini':
          return await decomposeWithGemini(systemPrompt, featureRequest);
        case 'groq':
          return await decomposeWithGroq(systemPrompt, featureRequest);
        case 'local':
          return decomposeWithLocal(featureRequest);
        default:
          throw new Error(`Unsupported Tech Lead provider: ${provider}`);
      }
    } catch (err) {
      const message = err?.message || String(err);
      console.error(`[TechLead] ${provider} failed: ${message}`);
      errors.push(`${provider}: ${message}`);
    }
  }

  throw new Error(`Tech Lead decomposition failed. ${errors.join(' | ')}`);
}

function buildTechLeadProviderOrder() {
  const primary = (process.env.TECH_LEAD_PROVIDER || 'groq').toLowerCase();
  const fallbacks = (process.env.TECH_LEAD_FALLBACKS || 'openai,claude,gemini,local')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const ordered = [primary, ...fallbacks];
  // Remove duplicates while preserving order
  return ordered.filter((value, index) => ordered.indexOf(value) === index);
}

function cleanModelJson(raw) {
  return raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function parseModelJson(raw, provider) {
  const cleaned = cleanModelJson(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      return JSON.parse(jsonrepair(cleaned));
    } catch (err) {
      throw new Error(`${provider} returned invalid JSON: ${err.message}`);
    }
  }
}

async function decomposeWithClaude(systemPrompt, featureRequest) {
  // Default: Haiku (20x cheaper than Opus, handles JSON decomposition well)
  // Override with TECH_LEAD_CLAUDE_MODEL=claude-opus-4-6 for harder tasks
  const model = process.env.TECH_LEAD_CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    // Prompt caching: system prompt cached for 5 min — saves ~80% of input tokens on repeated calls
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: featureRequest }],
  });

  const raw = response.content[0].text.trim();
  return parseModelJson(raw, 'claude');
}

async function decomposeWithOpenAI(systemPrompt, featureRequest) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured.');
  }

  const response = await openai.chat.completions.create({
    model: process.env.TECH_LEAD_OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: featureRequest },
    ],
    temperature: 0.2,
  });

  const raw = response.choices[0].message.content.trim();
  return parseModelJson(raw, 'openai');
}

async function decomposeWithGemini(systemPrompt, featureRequest) {
  const modelId = await resolveGeminiModel({
    apiKey: process.env.GEMINI_API_KEY,
    preferredModel: process.env.TECH_LEAD_GEMINI_MODEL || 'gemini-1.5-flash',
  });
  const model = genAI.getGenerativeModel({ model: modelId });
  const result = await model.generateContent(`${systemPrompt}\n\n${featureRequest}`);
  const raw = result.response.text().trim();
  return parseModelJson(raw, 'gemini');
}

async function decomposeWithGroq(systemPrompt, featureRequest) {
  if (!groqTechLead) {
    throw new Error('Groq API key not configured. Add GROQ_API_KEY to .env (free at console.groq.com).');
  }

  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const response = await groqTechLead.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: featureRequest },
    ],
    temperature: 0.2,
  });

  const raw = response.choices[0].message.content.trim();
  return parseModelJson(raw, 'groq');
}

function decomposeWithLocal(featureRequest) {
  const feature = featureRequest.trim();
  return {
    feature,
    architecture_decision:
      'Fallback mode: use existing project patterns with a single implementation task to unblock execution.',
    tasks: [
      {
        task_id: nextTaskId(),
        assigned_to: 'Local',
        task: featureRequest,
        input: 'Repository context and any referenced files in the workspace.',
        expected_output: 'Production-ready code changes implementing the request.',
        depends_on: [],
      },
    ],
    integration_notes:
      'Apply generated changes to the codebase following existing conventions and wiring.',
    review_checklist: [
      'Code compiles and runs',
      'Basic error handling included',
      'No sensitive data logged',
    ],
  };
}

/**
 * Build the full prompt to send to a team member for their assigned task.
 * @param {object} task - Task object from decomposition
 * @returns {string}
 */
function buildTaskPrompt(task) {
  return `You have been assigned the following task by the Tech Lead (Groge):

Task ID: ${task.task_id}
Task: ${task.task}
Input available: ${task.input}
Expected output: ${task.expected_output}

Return ONLY valid JSON in this exact format:
{
  "task_id": "${task.task_id}",
  "status": "completed | blocked | needs_clarification",
  "code": {
    "files": [{"path": "<file path>", "content": "<full file content>"}]
  },
  "tests_written": true or false,
  "notes": "<anything the Tech Lead should know>",
  "learned": "<pattern or knowledge gained this session>"
}`;
}

/**
 * Main orchestrator entry point.
 * Decomposes the feature, executes each task, collects results, and prints summary.
 * @param {string} featureRequest - The feature or task description
 */
async function processTask(featureRequest) {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║     TECH LEAD ORCHESTRATOR  v1.0.0           ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`\n[Input] ${featureRequest}\n`);

  // Step 1: Tech Lead decomposes the feature
  let breakdown;
  try {
    breakdown = await decompose(featureRequest);
  } catch (err) {
    console.error('[TechLead] Failed to decompose task:', err.message);
    throw err;
  }

  console.log(`\n── ARCHITECTURE DECISION ───────────────────────`);
  console.log(`  Feature : ${breakdown.feature}`);
  console.log(`  Decision: ${breakdown.architecture_decision}`);
  console.log(`  Tasks   : ${breakdown.tasks.length}`);
  console.log(`────────────────────────────────────────────────\n`);

  // Step 2: Execute each task (respecting depends_on order)
  const results = [];
  const completed = new Set();

  for (const task of breakdown.tasks) {
    // Wait for dependencies
    for (const dep of (task.depends_on || [])) {
      if (!completed.has(dep)) {
        console.log(`  [SKIP] ${task.task_id} waiting on ${dep} — dependency not yet resolved.`);
        continue;
      }
    }

    const prompt = buildTaskPrompt(task);
    let result;

    try {
      result = await routeTask(task.task_id, task.assigned_to, prompt);
    } catch (err) {
      console.error(`  [ERROR] ${task.task_id} (${task.assigned_to}) failed:`, err.message);
      // Fallback chain: Groq → Ollama → Local
      const fallbacks = ['Groq', 'Ollama', 'Local'];
      let recovered = false;
      for (const fallback of fallbacks) {
        if (fallback === task.assigned_to) continue;
        try {
          console.log(`  [FALLBACK] Retrying ${task.task_id} with ${fallback}...`);
          result = await routeTask(task.task_id, fallback, prompt);
          recovered = true;
          break;
        } catch (fbErr) {
          console.error(`  [FALLBACK] ${fallback} also failed:`, fbErr.message);
        }
      }
      if (!recovered) {
        result = {
          task_id: task.task_id,
          status: 'blocked',
          code: { files: [] },
          tests_written: false,
          notes: `All executors failed. Last error: ${err.message}`,
          learned: 'Task failed — all fallbacks exhausted.',
        };
      }
    }

    // Store learning in team memory
    if (result.learned) {
      remember(task.assigned_to, task.task_id, result.learned);
    }

    results.push({ task, result });
    completed.add(task.task_id);

    console.log(`  [${result.status.toUpperCase()}] ${task.task_id} → ${task.assigned_to}`);
  }

  // Step 3: Print integration notes and review checklist
  console.log('\n── INTEGRATION NOTES ───────────────────────────');
  console.log(`  ${breakdown.integration_notes}`);

  console.log('\n── REVIEW CHECKLIST ────────────────────────────');
  (breakdown.review_checklist || []).forEach((item, i) =>
    console.log(`  ${i + 1}. ${item}`)
  );

  // Step 4: Print generated files
  console.log('\n── GENERATED FILES ─────────────────────────────');
  for (const { task, result } of results) {
    const files = result?.code?.files || [];
    if (files.length === 0) {
      console.log(`  ${task.task_id} (${task.assigned_to}): no files generated`);
    } else {
      files.forEach((f) => console.log(`  ${task.task_id} (${task.assigned_to}): ${f.path}`));
      // Print file contents
      files.forEach((f) => {
        console.log(`\n  ── ${f.path} ──`);
        console.log(f.content);
      });
    }
  }

  // Step 5: Write generated files to disk
  const outputRoot = path.resolve('output');
  let filesWritten = 0;
  for (const { result } of results) {
    for (const file of (result?.code?.files || [])) {
      if (!file.path || !file.content) continue;
      const dest = path.join(outputRoot, file.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.content, 'utf8');
      filesWritten++;
    }
  }
  if (filesWritten > 0) {
    console.log(`\n── SAVED TO DISK ────────────────────────────────`);
    console.log(`  ${filesWritten} file(s) written to: output/`);
    console.log('────────────────────────────────────────────────────\n');
  }

  // Step 6: Team learning summary
  printSummary();

  return { breakdown, results };
}

module.exports = { processTask };
