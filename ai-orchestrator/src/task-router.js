// src/task-router.js
// Routes tasks to the correct team member based on task type.
// Executes the task against each AI's SDK and returns structured output.

const { jsonrepair } = require('jsonrepair');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { resolveGeminiModel } = require('./gemini-models');
const { runLocal } = require('./local-executor');

function parseTaskJson(raw) {
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return JSON.parse(jsonrepair(cleaned));
  }
}

const anthropic = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const openai = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });

// Groq — free tier, OpenAI-compatible. Add GROQ_API_KEY to .env.
// Free models: llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768
const groq = process.env.GROQ_API_KEY
  ? new OpenAI.default({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    })
  : null;

// Ollama — fully local, zero cost. Run: ollama pull llama3.2
// Set OLLAMA_BASE_URL (default: http://localhost:11434/v1) and OLLAMA_MODEL
const ollama = new OpenAI.default({
  apiKey: 'ollama',
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
});

// Kimi uses OpenAI-compatible API (Moonshot AI) — no extra SDK needed.
// Add KIMI_API_KEY to your .env to activate.
const kimi = process.env.KIMI_API_KEY
  ? new OpenAI.default({
      apiKey: process.env.KIMI_API_KEY,
      baseURL: 'https://api.moonshot.cn/v1',
    })
  : null;

// Amazon Q uses AWS Bedrock (Claude on Bedrock) — reuses AWS credentials from .env.
// Add BEDROCK_MODEL_ID to .env to override default model.
// Requires: npm install @aws-sdk/client-bedrock-runtime
let bedrock = null;
try {
  const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
  bedrock = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  bedrock._ConverseCommand = ConverseCommand;
} catch {
  // SDK not installed — AmazonQ/UIDesigner will fall back to stub
  bedrock = null;
}

/**
 * Detect which team member should handle this task.
 * @param {string} taskType - Type label from Tech Lead decomposition
 * @returns {string} Member name
 */
function detectAssignee(taskType) {
  const type = (taskType || '').toLowerCase();
  if (type.includes('research') || type.includes('doc')) return 'Gemini';
  if (type.includes('aws') || type.includes('security')) return 'AmazonQ';
  if (type.includes('devops') || type.includes('infra')) return 'Kilo';
  if (type.includes('backend') || type.includes('long-doc')) return 'Kimi';
  if (type.includes('ui') || type.includes('ux') || type.includes('design') ||
      type.includes('wireframe') || type.includes('frontend') || type.includes('css')) return 'UIDesigner';
  // Default: ChatGPT for full-stack; falls back to Groq (free) if no OpenAI key
  return process.env.OPENAI_API_KEY ? 'ChatGPT' : 'Groq';
}

/**
 * Execute task with ChatGPT (OpenAI).
 * @param {string} taskId
 * @param {string} prompt
 * @returns {Promise<object>}
 */
// Official ChatGPT system prompt — matches the role definition given to ChatGPT manually.
const CHATGPT_SYSTEM_PROMPT = `You are a Full Stack Developer in an AI development team led by Groge (Tech Lead).

ROLE: Implement features based on task specifications provided by the Tech Lead.

RULES:
- Always follow the architecture decisions made by Groge
- Output clean, production-ready code with comments
- Flag any blockers or ambiguities before coding
- Return output in this format:

{
  "task_id": "<from spec>",
  "status": "completed | blocked | needs_clarification",
  "code": {
    "files": [{"path": "<file>", "content": "<code>"}]
  },
  "tests_written": true/false,
  "notes": "<anything Tech Lead should know>",
  "learned": "<what pattern or knowledge gained this session>"
}

Return ONLY valid JSON. No extra text outside the JSON object.`;

async function runChatGPT(taskId, prompt) {
  console.log(`  [ChatGPT] Executing task ${taskId}...`);
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: CHATGPT_SYSTEM_PROMPT,
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
  });

  return parseTaskJson(response.choices[0].message.content.trim());
}

/**
 * Execute task with Gemini (Google).
 * @param {string} taskId
 * @param {string} prompt
 * @returns {Promise<object>}
 */
async function runGemini(taskId, prompt) {
  console.log(`  [Gemini] Executing task ${taskId}...`);
  const modelId = await resolveGeminiModel({
    apiKey: process.env.GEMINI_API_KEY,
    preferredModel:
      process.env.GEMINI_TASK_MODEL || process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  });
  const model = genAI.getGenerativeModel({ model: modelId });
  const result = await model.generateContent(
    'You are a Research & Documentation Specialist in an AI team led by Groge (Tech Lead). ' +
    'Return ONLY valid JSON matching the specified output format. No extra text.\n\n' +
    prompt
  );
  return parseTaskJson(result.response.text().trim());
}

// Official Kimi system prompt — matches the role definition given to Kimi manually.
const KIMI_SYSTEM_PROMPT = `You are the Backend Logic Specialist and Document Analyst in an AI development team.

STRENGTHS: Large context analysis, complex business logic, API design.

When given tasks:
1. Analyze all provided documents/context thoroughly before responding
2. Design robust backend logic with edge cases covered
3. Return structured output matching team format
4. Document every decision with reasoning

Output format matches team standard JSON structure:
{
  "task_id": "<from spec>",
  "status": "completed | blocked | needs_clarification",
  "code": {
    "files": [{"path": "<file>", "content": "<code>"}]
  },
  "tests_written": true/false,
  "notes": "<anything Tech Lead should know>",
  "learned": "<what pattern or knowledge gained this session>"
}

Track patterns from previous tasks to improve future implementations.
Return ONLY valid JSON. No extra text outside the JSON object.`;

/**
 * Execute task with Kimi (Moonshot AI — OpenAI-compatible).
 * Requires KIMI_API_KEY in .env.
 * @param {string} taskId
 * @param {string} prompt
 * @returns {Promise<object>}
 */
async function runKimi(taskId, prompt) {
  // Try Moonshot AI if key is configured
  if (kimi) {
    try {
      console.log(`  [Kimi] Executing task ${taskId}...`);
      const response = await kimi.chat.completions.create({
        model: 'moonshot-v1-8k',
        messages: [
          { role: 'system', content: KIMI_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      });
      return parseTaskJson(response.choices[0].message.content.trim());
    } catch (err) {
      console.log(`  [Kimi] Moonshot failed (${err.message}) — switching to Groq with Kimi persona...`);
    }
  } else {
    console.log(`  [Kimi] No KIMI_API_KEY — using Groq with Kimi persona...`);
  }

  // Internal fallback: Groq with Kimi's system prompt (no key needed beyond GROQ_API_KEY)
  if (!groq) {
    throw new Error('Neither Kimi nor Groq is configured. Add KIMI_API_KEY or GROQ_API_KEY to .env.');
  }
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const response = await groq.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: KIMI_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
  });
  return parseTaskJson(response.choices[0].message.content.trim());
}

// Official Amazon Q system prompt — matches the role definition given to Amazon Q manually.
const AMAZON_Q_SYSTEM_PROMPT = `You are the AWS Services & Security Specialist in an AI development team led by Groge (Tech Lead).

ROLE: Design and implement AWS infrastructure, security policies, and cloud-native
solutions based on task specifications provided by the Tech Lead.

STRENGTHS: AWS services (Lambda, S3, RDS, ECS, IAM, VPC, CloudFormation, CDK),
security best practices, IAM policies, cost optimization, compliance.

RULES:
- Always follow AWS Well-Architected Framework principles
- Apply least-privilege IAM policies by default
- Flag security risks or compliance concerns before implementing
- Include cost estimates or optimization tips where relevant
- Follow the architecture decisions made by Groge (Tech Lead)

Return output in this format:
{
  "task_id": "<from spec>",
  "status": "completed | blocked | needs_clarification",
  "code": {
    "files": [{"path": "<file>", "content": "<code>"}]
  },
  "aws_services_used": ["<service1>", "<service2>"],
  "security_notes": "<IAM policies, encryption, compliance flags>",
  "cost_estimate": "<rough monthly cost if applicable>",
  "tests_written": true/false,
  "notes": "<anything Tech Lead should know>",
  "learned": "<what pattern or knowledge gained this session>"
}

Return ONLY valid JSON. No extra text outside the JSON object.`;

/**
 * Execute task with Amazon Q via AWS Bedrock.
 * Uses existing AWS credentials from .env (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION).
 * Requires: npm install @aws-sdk/client-bedrock-runtime
 * @param {string} taskId
 * @param {string} prompt
 * @returns {Promise<object>}
 */
async function runAmazonQ(taskId, prompt) {
  // Try Bedrock first if SDK is installed
  if (bedrock) {
    try {
      console.log(`  [AmazonQ] Executing task ${taskId} via AWS Bedrock...`);
      const modelId = process.env.BEDROCK_MODEL_ID || 'us.amazon.nova-micro-v1:0';
      const command = new bedrock._ConverseCommand({
        modelId,
        system: [{ text: AMAZON_Q_SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 2048, temperature: 0.3 },
      });
      const response = await bedrock.send(command);
      return parseTaskJson(response.output.message.content[0].text.trim());
    } catch (err) {
      console.log(`  [AmazonQ] Bedrock failed (${err.message}) — switching to Groq with AmazonQ persona...`);
    }
  } else {
    console.log(`  [AmazonQ] Bedrock SDK not available — using Groq with AmazonQ persona...`);
  }

  // Internal fallback: Groq with AmazonQ's system prompt
  if (!groq) throw new Error('Neither Bedrock nor Groq is configured. Add GROQ_API_KEY to .env.');
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const response = await groq.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: AMAZON_Q_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
  });
  return parseTaskJson(response.choices[0].message.content.trim());
}

/**
 * Execute task with Groq (free tier — OpenAI-compatible).
 * Requires GROQ_API_KEY in .env. Get one free at https://console.groq.com
 * @param {string} taskId
 * @param {string} prompt
 * @returns {Promise<object>}
 */
async function runGroq(taskId, prompt) {
  if (!groq) {
    console.log(`  [Groq] GROQ_API_KEY not set — add it to .env (free at console.groq.com).`);
    return {
      task_id: taskId,
      status: 'needs_clarification',
      code: { files: [] },
      tests_written: false,
      notes: 'Groq not activated. Add GROQ_API_KEY=<your-key> to .env (free tier available).',
      learned: 'Groq requires GROQ_API_KEY from https://console.groq.com',
    };
  }

  console.log(`  [Groq] Executing task ${taskId}...`);
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const response = await groq.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: CHATGPT_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
  });

  return parseTaskJson(response.choices[0].message.content.trim());
}

/**
 * Execute task with Ollama (local, zero cost).
 * Requires Ollama running locally: https://ollama.ai
 * Set OLLAMA_MODEL in .env (default: llama3.2). Run: ollama pull llama3.2
 * @param {string} taskId
 * @param {string} prompt
 * @returns {Promise<object>}
 */
async function runOllama(taskId, prompt) {
  console.log(`  [Ollama] Executing task ${taskId}...`);
  const model = process.env.OLLAMA_MODEL || 'llama3.2';

  try {
    const response = await ollama.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: CHATGPT_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
    });

    const raw = response.choices[0].message.content.trim();
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.log(`  [Ollama] Failed — is Ollama running? Start with: ollama serve`);
    throw err;
  }
}

const UI_DESIGNER_SYSTEM_PROMPT = `You are a Senior UI/UX Designer in an AI development team led by Groge (Tech Lead).

ROLE: Design user interfaces, create component structures, and produce production-ready HTML/CSS/Tailwind code.

STRENGTHS: Wireframes, design systems, responsive layouts, accessibility (WCAG 2.1), Tailwind CSS, React component design, colour palettes, typography, micro-interactions.

RULES:
- Always follow modern design principles: visual hierarchy, whitespace, consistency
- Produce semantic HTML with accessible ARIA labels
- Use Tailwind CSS utility classes by default unless another framework is specified
- Include responsive breakpoints (mobile-first)
- Comment design decisions inline
- Flag any UX concerns or missing user flows

Return output in this format:
{
  "task_id": "<from spec>",
  "status": "completed | blocked | needs_clarification",
  "code": {
    "files": [{"path": "<file>", "content": "<code>"}]
  },
  "design_notes": "<colour palette, typography, spacing decisions>",
  "accessibility_notes": "<WCAG considerations>",
  "tests_written": false,
  "notes": "<anything Tech Lead should know>",
  "learned": "<what pattern or knowledge gained this session>"
}

Return ONLY valid JSON. No extra text outside the JSON object.`;

/**
 * Execute task with UIDesigner via AWS Bedrock (Claude Sonnet on Bedrock).
 * Falls back to Groq if Bedrock is unavailable.
 * Override model with UI_DESIGNER_MODEL in .env (default: anthropic.claude-sonnet-4-20250514-v1:0).
 * @param {string} taskId
 * @param {string} prompt
 * @returns {Promise<object>}
 */
async function runUIDesigner(taskId, prompt) {
  // Try Bedrock first if SDK is installed
  if (bedrock) {
    try {
      console.log(`  [UIDesigner] Executing task ${taskId} via AWS Bedrock...`);
      const modelId = process.env.UI_DESIGNER_MODEL || 'us.anthropic.claude-sonnet-4-20250514-v1:0';
      const command = new bedrock._ConverseCommand({
        modelId,
        system: [{ text: UI_DESIGNER_SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 4096, temperature: 0.3 },
      });
      const response = await bedrock.send(command);
      return parseTaskJson(response.output.message.content[0].text.trim());
    } catch (err) {
      console.log(`  [UIDesigner] Bedrock failed (${err.message}) — switching to Groq with UIDesigner persona...`);
    }
  } else {
    console.log(`  [UIDesigner] Bedrock SDK not available — using Groq with UIDesigner persona...`);
  }

  // Internal fallback: Groq with UIDesigner's system prompt
  if (!groq) throw new Error('Neither Bedrock nor Groq is configured. Add GROQ_API_KEY to .env.');
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const response = await groq.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: UI_DESIGNER_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
  });
  return parseTaskJson(response.choices[0].message.content.trim());
}

/**
 * Stub for team members without SDK integration yet.
 * @param {string} member
 * @param {string} taskId
 * @param {string} prompt
 * @returns {Promise<object>}
 */
async function runStub(member, taskId, prompt) {
  console.log(`  [${member}] SDK not configured — returning stub response.`);
  return {
    task_id: taskId,
    status: 'needs_clarification',
    code: { files: [] },
    tests_written: false,
    notes: `${member} SDK not yet integrated. Configure API key and client in task-router.js.`,
    learned: `${member} stub invoked for task ${taskId}.`,
  };
}

/**
 * Route and execute a task to the correct team member.
 * @param {string} taskId
 * @param {string} assignedTo - Member name
 * @param {string} prompt - Full task prompt to send
 * @returns {Promise<object>} Structured response from team member
 */
async function routeTask(taskId, assignedTo, prompt) {
  switch (assignedTo) {
    case 'ChatGPT':
      return runChatGPT(taskId, prompt);
    case 'Gemini':
      return runGemini(taskId, prompt);
    case 'Kimi':
      return runKimi(taskId, prompt);
    case 'AmazonQ':
      return runAmazonQ(taskId, prompt);
    case 'Groq':
      return runGroq(taskId, prompt);
    case 'Ollama':
      return runOllama(taskId, prompt);
    case 'UIDesigner':
      return runUIDesigner(taskId, prompt);
    case 'Local':
      return runLocal(taskId, prompt);
    case 'Stub':
      return runStub(assignedTo, taskId, prompt);
    default:
      return runChatGPT(taskId, prompt);
  }
}

module.exports = { routeTask, detectAssignee };
