#!/usr/bin/env node
/**
 * skill-intake.cjs — Observe-only skill/repo candidate registry reader.
 * Reads data/mission-control/skill-intake.json, validates, and emits a JSON summary.
 * Never clones, installs, fetches, executes, or mutates anything.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'mission-control', 'skill-intake.json');
const AGENT = 'Skill Intake';
const LABEL = 'OBSERVE ONLY';

const REQUIRED_FIELDS = [
  'name',
  'repo_url',
  'category',
  'proposed_use',
  'integration_status',
  'risk_level',
  'allowed_actions',
  'forbidden_actions',
  'notes',
];

function pushUnique(values, nextValue) {
  if (nextValue && !values.includes(nextValue)) {
    values.push(nextValue);
  }
}

function validate(entries) {
  const errors = [];
  for (const [i, entry] of entries.entries()) {
    for (const field of REQUIRED_FIELDS) {
      if (!(field in entry) || entry[field] === null || entry[field] === undefined) {
        errors.push(`entry[${i}] (${entry.name || '?'}) missing required field: ${field}`);
      }
    }
    if (typeof entry.risk_level !== 'number' || ![0, 1, 2, 3].includes(entry.risk_level)) {
      errors.push(`entry[${i}] (${entry.name}) risk_level must be 0|1|2|3, got: ${entry.risk_level}`);
    }
    if (!Array.isArray(entry.allowed_actions)) {
      errors.push(`entry[${i}] (${entry.name}) allowed_actions must be an array`);
    }
    if (!Array.isArray(entry.forbidden_actions)) {
      errors.push(`entry[${i}] (${entry.name}) forbidden_actions must be an array`);
    }
  }
  return errors;
}

function summarize(entries) {
  const byCategory = {};
  const byRisk = { 0: 0, 1: 0, 2: 0, 3: 0 };

  for (const e of entries) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    byRisk[e.risk_level] = (byRisk[e.risk_level] || 0) + 1;
  }

  return { byCategory, byRisk };
}

function createBaseResult(overrides = {}) {
  const timestamp = new Date().toISOString();

  return {
    agent: AGENT,
    label: LABEL,
    status: 'PASS',
    risk_level: 0,
    summary: {},
    checks: [],
    failures: [],
    warnings: [],
    next_actions: [],
    recommended_next_actions: [],
    validation: { steps: [] },
    metadata: {
      root: ROOT,
      data_path: DATA_PATH,
      checked_at: timestamp,
      observe_only: true,
      file_mutation: false,
      network_calls: false,
    },
    schema_version: '1',
    total: 0,
    candidates: 0,
    counts_by_category: {},
    counts_by_risk: { 0: 0, 1: 0, 2: 0, 3: 0 },
    candidate_list: [],
    validation_errors: [],
    ...overrides,
  };
}

function emitResult(result, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(exitCode);
}

function failResult(message, options = {}) {
  const failures = [message];
  const nextActions = [];
  const validationErrors = options.validationErrors || failures;
  const validationSteps = Array.isArray(options.validationSteps) ? options.validationSteps : [];

  pushUnique(nextActions, 'Restore a valid observe-only skill intake registry before reporting Mission Control completion.');

  return createBaseResult({
    status: 'FAIL',
    risk_level: 3,
    summary: {
      total_entries: options.totalEntries || 0,
      candidate_count: options.candidateCount || 0,
      validation_error_count: validationErrors.length,
      observe_only: true,
    },
    checks: Array.isArray(options.checks) ? options.checks : [],
    failures,
    next_actions: nextActions,
    recommended_next_actions: [...nextActions],
    validation: { steps: validationSteps },
    metadata: {
      root: ROOT,
      data_path: DATA_PATH,
      checked_at: new Date().toISOString(),
      observe_only: true,
      file_mutation: false,
      network_calls: false,
      schema_version: options.schemaVersion || '1',
    },
    schema_version: options.schemaVersion || '1',
    total: options.totalEntries || 0,
    candidates: options.candidateCount || 0,
    counts_by_category: options.counts_by_category || {},
    counts_by_risk: options.counts_by_risk || { 0: 0, 1: 0, 2: 0, 3: 0 },
    candidate_list: options.candidate_list || [],
    validation_errors: validationErrors,
  });
}

let raw;
try {
  raw = fs.readFileSync(DATA_PATH, 'utf-8');
} catch (e) {
  emitResult(failResult(`Cannot read ${DATA_PATH}: ${e.message}`, {
    checks: [
      { name: 'data:read', status: 'FAIL', message: `Cannot read ${DATA_PATH}: ${e.message}` },
    ],
    validationSteps: [
      { step: 'read-skill-intake-json', status: 'FAIL' },
    ],
  }), 1);
}

let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  emitResult(failResult(`Invalid JSON in skill-intake.json: ${e.message}`, {
    schemaVersion: '1',
    checks: [
      { name: 'data:read', status: 'PASS', message: `Loaded ${DATA_PATH}` },
      { name: 'data:parse', status: 'FAIL', message: `Invalid JSON in skill-intake.json: ${e.message}` },
    ],
    validationSteps: [
      { step: 'read-skill-intake-json', status: 'PASS' },
      { step: 'parse-skill-intake-json', status: 'FAIL' },
    ],
  }), 1);
}

const entries = Array.isArray(data.entries) ? data.entries : [];
const validationErrors = validate(entries);

const candidates = entries
  .filter(e => e.integration_status === 'candidate')
  .map(e => ({
    name: e.name,
    repo_url: e.repo_url,
    category: e.category,
    risk_level: e.risk_level,
    proposed_use: e.proposed_use,
    allowed_actions: e.allowed_actions,
  }));

const { byCategory, byRisk } = summarize(entries);

if (validationErrors.length > 0) {
  emitResult(failResult('Skill intake registry validation failed.', {
    schemaVersion: data.schema_version || '1',
    totalEntries: entries.length,
    candidateCount: candidates.length,
    checks: [
      { name: 'data:read', status: 'PASS', message: `Loaded ${DATA_PATH}` },
      { name: 'data:parse', status: 'PASS', message: 'Parsed skill intake JSON' },
      { name: 'data:validate', status: 'FAIL', message: `${validationErrors.length} validation error(s)` },
    ],
    validationErrors,
    validationSteps: [
      { step: 'read-skill-intake-json', status: 'PASS' },
      { step: 'parse-skill-intake-json', status: 'PASS' },
      { step: 'validate-skill-intake-entries', status: 'FAIL' },
    ],
    counts_by_category: byCategory,
    counts_by_risk: byRisk,
    candidate_list: candidates,
  }), 1);
}

const nextActions = ['Maintain observe-only review boundaries for all listed candidates.'];

emitResult(createBaseResult({
  status: 'PASS',
  risk_level: 0,
  summary: {
    total_entries: entries.length,
    candidate_count: candidates.length,
    validation_error_count: 0,
    observe_only: true,
  },
  checks: [
    { name: 'data:read', status: 'PASS', message: `Loaded ${DATA_PATH}` },
    { name: 'data:parse', status: 'PASS', message: 'Parsed skill intake JSON' },
    { name: 'data:validate', status: 'PASS', message: 'All skill intake entries passed validation' },
  ],
  next_actions: nextActions,
  recommended_next_actions: [...nextActions],
  validation: {
    steps: [
      { step: 'read-skill-intake-json', status: 'PASS' },
      { step: 'parse-skill-intake-json', status: 'PASS' },
      { step: 'validate-skill-intake-entries', status: 'PASS' },
    ],
  },
  metadata: {
    root: ROOT,
    data_path: DATA_PATH,
    checked_at: new Date().toISOString(),
    observe_only: true,
    file_mutation: false,
    network_calls: false,
    schema_version: data.schema_version || '1',
    description: data.description || null,
  },
  schema_version: data.schema_version || '1',
  total: entries.length,
  candidates: candidates.length,
  counts_by_category: byCategory,
  counts_by_risk: byRisk,
  candidate_list: candidates,
  validation_errors: [],
}));
