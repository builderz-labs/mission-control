// src/local-executor.js
// Local fallback executor that generates simple scaffolds without external APIs.

function extractTaskText(prompt) {
  const match = prompt.match(/^\s*Task:\s*(.+)$/im);
  return (match ? match[1] : prompt).trim();
}

function buildExpressUserCrud(taskId) {
  const filePath = `local-output/${taskId}/users.routes.js`;
  const content = [
    "const express = require('express');",
    '',
    'const router = express.Router();',
    'const users = [];',
    'let nextId = 1;',
    '',
    "router.get('/', (req, res) => {",
    '  res.json(users);',
    '});',
    '',
    "router.get('/:id', (req, res) => {",
    '  const id = Number(req.params.id);',
    '  const user = users.find((item) => item.id === id);',
    '  if (!user) {',
    "    return res.status(404).json({ error: 'User not found' });",
    '  }',
    '  return res.json(user);',
    '});',
    '',
    "router.post('/', (req, res) => {",
    '  const { name, email } = req.body || {};',
    '  if (!name || !email) {',
    "    return res.status(400).json({ error: 'name and email are required' });",
    '  }',
    '  const newUser = { id: nextId++, name, email };',
    '  users.push(newUser);',
    '  return res.status(201).json(newUser);',
    '});',
    '',
    "router.put('/:id', (req, res) => {",
    '  const id = Number(req.params.id);',
    '  const user = users.find((item) => item.id === id);',
    '  if (!user) {',
    "    return res.status(404).json({ error: 'User not found' });",
    '  }',
    '  const { name, email } = req.body || {};',
    '  if (!name || !email) {',
    "    return res.status(400).json({ error: 'name and email are required' });",
    '  }',
    '  user.name = name;',
    '  user.email = email;',
    '  return res.json(user);',
    '});',
    '',
    "router.delete('/:id', (req, res) => {",
    '  const id = Number(req.params.id);',
    '  const index = users.findIndex((item) => item.id === id);',
    '  if (index === -1) {',
    "    return res.status(404).json({ error: 'User not found' });",
    '  }',
    '  users.splice(index, 1);',
    '  return res.status(204).send();',
    '});',
    '',
    'module.exports = router;',
    '',
  ].join('\n');

  return {
    task_id: taskId,
    status: 'completed',
    code: {
      files: [{ path: filePath, content }],
    },
    tests_written: false,
    notes:
      'Generated an Express router with in-memory CRUD for users. Replace the in-memory array with database access and wire the router in your app.',
    learned: 'Local executor generated a CRUD scaffold for Express users.',
  };
}

async function runLocal(taskId, prompt) {
  const taskText = extractTaskText(prompt).toLowerCase();
  const isCrud = taskText.includes('crud');
  const isExpress = taskText.includes('express');
  const isUser = taskText.includes('user');

  if (isCrud && isExpress && isUser) {
    return buildExpressUserCrud(taskId);
  }

  return {
    task_id: taskId,
    status: 'needs_clarification',
    code: { files: [] },
    tests_written: false,
    notes:
      'Local executor only supports simple Express CRUD scaffolds. Provide a clearer task statement or enable an external provider.',
    learned: 'Local executor did not match a supported scaffold pattern.',
  };
}

module.exports = { runLocal };
