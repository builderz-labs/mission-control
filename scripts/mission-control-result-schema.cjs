#!/usr/bin/env node
/**
 * mission-control-result-schema.cjs
 * Canonical Mission Control result contract with legacy compatibility.
 */

'use strict';

const VALID_STATUSES = ['PASS', 'WARN', 'FAIL'];
const VALID_VALIDATION_STATUSES = ['PASS', 'WARN', 'FAIL', 'NOT_RUN'];
const REQUIRED_RESULT_FIELDS = [
  'status',
  'risk_level',
  'summary',
  'checks',
  'failures',
  'warnings',
  'next_actions',
  'validation',
  'metadata',
];

const LEGACY_FIELD_ALIASES = new Map([
  ['recommended_next_actions', 'next_actions'],
]);

function pushUnique(values, nextValue) {
  if (nextValue && !values.includes(nextValue)) {
    values.push(nextValue);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeValidationStepStatus(step) {
  if (!isPlainObject(step)) return 'UNKNOWN';

  if (typeof step.status === 'string') {
    const status = step.status.toUpperCase();
    if (status === 'OK') return 'PASS';
    return status;
  }

  if (step.skipped === true) return 'NOT_RUN';
  if (step.passed === true) return 'PASS';
  if (step.passed === false) return 'FAIL';

  return 'UNKNOWN';
}

function validateMissionControlResult(result, options = {}) {
  const failures = [];
  const warnings = [];
  const warnOnUnknownFields = options.warnOnUnknownFields === true;
  const requiredFields = Array.isArray(options.requiredFields) && options.requiredFields.length > 0
    ? options.requiredFields
    : REQUIRED_RESULT_FIELDS;

  if (!isPlainObject(result)) {
    return {
      valid: false,
      failures: ['Result must be an object'],
      warnings: [],
    };
  }

  const normalized = { ...result };
  const knownFields = new Set([
    ...REQUIRED_RESULT_FIELDS,
    ...requiredFields,
    ...LEGACY_FIELD_ALIASES.keys(),
  ]);

  if (normalized.status === undefined) {
    pushUnique(failures, 'Missing required field: status');
  } else if (typeof normalized.status !== 'string') {
    pushUnique(failures, 'status must be a string');
  } else {
    const upperStatus = normalized.status.toUpperCase();
    if (upperStatus === 'OK') {
      normalized.status = 'PASS';
      pushUnique(warnings, 'Legacy status OK normalized to PASS');
    } else if (VALID_STATUSES.includes(upperStatus)) {
      normalized.status = upperStatus;
    } else {
      pushUnique(failures, `Unknown status value: ${upperStatus}`);
    }
  }

  if (!Number.isFinite(normalized.risk_level) || normalized.risk_level < 0) {
    if (normalized.risk_level === undefined) {
      pushUnique(failures, 'Missing required field: risk_level');
    } else {
      pushUnique(failures, 'risk_level must be a finite number >= 0');
    }
  }

  if (normalized.summary === undefined) {
    pushUnique(failures, 'Missing required field: summary');
  } else if (!isPlainObject(normalized.summary)) {
    pushUnique(failures, 'summary must be an object');
  }

  for (const field of ['checks', 'failures', 'warnings']) {
    if (normalized[field] === undefined) {
      pushUnique(failures, `Missing required field: ${field}`);
      continue;
    }
    if (!Array.isArray(normalized[field])) {
      pushUnique(failures, `${field} must be an array`);
    }
  }

  if (normalized.next_actions === undefined) {
    if (Array.isArray(normalized.recommended_next_actions)) {
      normalized.next_actions = [...normalized.recommended_next_actions];
    } else {
      pushUnique(failures, 'Missing required field: next_actions');
    }
  } else if (!Array.isArray(normalized.next_actions)) {
    pushUnique(failures, 'next_actions must be an array');
  }

  if (normalized.validation === undefined) {
    pushUnique(failures, 'Missing required field: validation');
  } else if (!isPlainObject(normalized.validation)) {
    pushUnique(failures, 'validation must be an object');
  } else {
    const sourceSteps = Array.isArray(normalized.validation.steps)
      ? normalized.validation.steps
      : Array.isArray(normalized.validation.commands)
        ? normalized.validation.commands
        : [];

    const normalizedSteps = [];

    for (const [index, step] of sourceSteps.entries()) {
      if (!isPlainObject(step)) {
        pushUnique(failures, `validation step ${index + 1} must be an object`);
        continue;
      }

      const stepName = step.step || step.name || step.command || `validation-${index + 1}`;
      const normalizedStepStatus = normalizeValidationStepStatus(step);

      if (!VALID_VALIDATION_STATUSES.includes(normalizedStepStatus)) {
        pushUnique(failures, `Unknown validation status for ${stepName}: ${normalizedStepStatus}`);
        continue;
      }

      normalizedSteps.push({
        ...step,
        step: stepName,
        status: normalizedStepStatus,
      });
    }

    normalized.validation = {
      ...normalized.validation,
      steps: normalizedSteps,
    };
  }

  if (normalized.metadata === undefined) {
    pushUnique(failures, 'Missing required field: metadata');
  } else if (!isPlainObject(normalized.metadata)) {
    pushUnique(failures, 'metadata must be an object');
  }

  for (const field of requiredFields) {
    if (normalized[field] === undefined) {
      pushUnique(failures, `Missing required field: ${field}`);
    }
  }

  if (warnOnUnknownFields) {
    for (const key of Object.keys(result)) {
      if (!knownFields.has(key)) {
        pushUnique(warnings, `Unknown field: ${key}`);
      }
    }
  }

  return {
    valid: failures.length === 0,
    failures,
    warnings,
    normalized,
  };
}

module.exports = {
  REQUIRED_RESULT_FIELDS,
  VALID_STATUSES,
  VALID_VALIDATION_STATUSES,
  validateMissionControlResult,
};
