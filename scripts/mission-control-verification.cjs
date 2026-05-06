#!/usr/bin/env node
/**
 * mission-control-verification.cjs
 * Minimal verification guard for completed Mission Control runs.
 */

'use strict';

const {
  VALID_VALIDATION_STATUSES,
  REQUIRED_RESULT_FIELDS,
  validateMissionControlResult,
} = require('./mission-control-result-schema.cjs');

function normalizeRunStatus(status) {
  if (typeof status !== 'string') return 'UNKNOWN';
  const upper = status.toUpperCase();
  if (upper === 'PASS' || upper === 'OK') return 'OK';
  if (upper === 'OK' || upper === 'WARN' || upper === 'FAIL') return upper;
  return upper;
}

function collectValidationChecks(output) {
  const steps = Array.isArray(output && output.validation && output.validation.steps)
    ? output.validation.steps
    : [];

  return steps.map((step, index) => ({
    name: step.step || step.name || step.command || `validation-${index + 1}`,
    status: typeof step.status === 'string' ? step.status.toUpperCase() : 'UNKNOWN',
  }));
}

function pushUnique(values, nextValue) {
  if (nextValue && !values.includes(nextValue)) {
    values.push(nextValue);
  }
}

function buildCanonicalCandidate(output) {
  const source = output && typeof output === 'object' ? output : {};

  return {
    ...source,
    summary: source.summary === undefined ? {} : source.summary,
    checks: source.checks === undefined ? [] : source.checks,
    failures: source.failures === undefined ? [] : source.failures,
    warnings: source.warnings === undefined ? [] : source.warnings,
    next_actions: source.next_actions !== undefined
      ? source.next_actions
      : Array.isArray(source.recommended_next_actions)
        ? source.recommended_next_actions
        : [],
    validation: source.validation === undefined ? {} : source.validation,
    metadata: source.metadata === undefined ? {} : source.metadata,
  };
}

function verifyCompletedRun(output, options = {}) {
  const checks = [];
  const canonicalCandidate = buildCanonicalCandidate(output);
  const schemaValidation = validateMissionControlResult(output, {
    requiredFields: Array.isArray(options.requiredFields) && options.requiredFields.length > 0
      ? options.requiredFields
      : REQUIRED_RESULT_FIELDS,
    warnOnUnknownFields: options.warnOnUnknownFields,
  });
  const canonicalSchemaValidation = validateMissionControlResult(canonicalCandidate, {
    requiredFields: Array.isArray(options.requiredFields) && options.requiredFields.length > 0
      ? options.requiredFields
      : REQUIRED_RESULT_FIELDS,
    warnOnUnknownFields: false,
  });
  const normalized = canonicalSchemaValidation.normalized || canonicalCandidate;
  const failures = [...canonicalSchemaValidation.failures];
  const warnings = [];
  for (const warning of [...schemaValidation.warnings, ...canonicalSchemaValidation.warnings]) {
    pushUnique(warnings, warning);
  }
  const next_actions = [];
  const requiredValidationCommands = Array.isArray(options.requiredValidationCommands)
    ? options.requiredValidationCommands
    : [];

  const addCheck = (name, status, message) => {
    checks.push({ name, status, message });
  };

  if (!canonicalSchemaValidation.valid) {
    pushUnique(next_actions, 'Return a canonical Mission Control result shape before reporting completion');
    addCheck('schema:result', 'FAIL', canonicalSchemaValidation.failures.join('; '));
  } else if (warnings.length > 0) {
    addCheck('schema:result', 'WARN', warnings.join('; '));
  } else {
    addCheck('schema:result', 'PASS', 'Mission Control result schema valid');
  }

  const validationChecks = collectValidationChecks(normalized);
  const validationByName = new Map(validationChecks.map((check) => [check.name, check.status]));

  for (const requiredCommand of requiredValidationCommands) {
    const commandStatus = validationByName.get(requiredCommand);

    if (!commandStatus) {
      const message = `Missing validation command result: ${requiredCommand}`;
      failures.push(message);
      pushUnique(next_actions, `Record validation outcome for ${requiredCommand}, or mark it NOT_RUN`);
      addCheck(`validation:${requiredCommand}`, 'FAIL', message);
      continue;
    }

    if (commandStatus === 'FAIL') {
      const message = `Validation command failed: ${requiredCommand}`;
      failures.push(message);
      pushUnique(next_actions, `Fix or rerun validation command: ${requiredCommand}`);
      addCheck(`validation:${requiredCommand}`, 'FAIL', message);
      continue;
    }

    if (commandStatus === 'NOT_RUN') {
      const message = `Validation command not run: ${requiredCommand}`;
      warnings.push(message);
      pushUnique(next_actions, `Run validation command when possible: ${requiredCommand}`);
      addCheck(`validation:${requiredCommand}`, 'WARN', message);
      continue;
    }

    if (!VALID_VALIDATION_STATUSES.includes(commandStatus)) {
      const message = `Unknown validation status for ${requiredCommand}: ${commandStatus}`;
      failures.push(message);
      pushUnique(next_actions, `Normalize validation status for ${requiredCommand}`);
      addCheck(`validation:${requiredCommand}`, 'FAIL', message);
      continue;
    }

    addCheck(`validation:${requiredCommand}`, 'PASS', `Validation recorded: ${requiredCommand}`);
  }

  for (const validationCheck of validationChecks) {
    if (requiredValidationCommands.includes(validationCheck.name)) {
      continue;
    }

    if (validationCheck.status === 'FAIL') {
      const message = `Validation command failed: ${validationCheck.name}`;
      failures.push(message);
      pushUnique(next_actions, `Fix or rerun validation command: ${validationCheck.name}`);
      addCheck(`validation:${validationCheck.name}`, 'FAIL', message);
      continue;
    }

    if (validationCheck.status === 'NOT_RUN') {
      const message = `Validation command not run: ${validationCheck.name}`;
      warnings.push(message);
      pushUnique(next_actions, `Run validation command when possible: ${validationCheck.name}`);
      addCheck(`validation:${validationCheck.name}`, 'WARN', message);
      continue;
    }

    if (!VALID_VALIDATION_STATUSES.includes(validationCheck.status)) {
      const message = `Unknown validation status for ${validationCheck.name}: ${validationCheck.status}`;
      failures.push(message);
      pushUnique(next_actions, `Normalize validation status for ${validationCheck.name}`);
      addCheck(`validation:${validationCheck.name}`, 'FAIL', message);
      continue;
    }
  }

  if (normalized && normalized.git) {
    if (normalized.git.is_clean === false && options.allowDirtyGit !== true) {
      const message = 'Working tree is dirty';
      warnings.push(message);
      pushUnique(next_actions, 'Review or explicitly allow the dirty working tree before reporting completion');
      addCheck('git:is_clean', 'WARN', message);
    } else if (typeof normalized.git.is_clean === 'boolean') {
      addCheck('git:is_clean', 'PASS', normalized.git.is_clean ? 'Working tree is clean' : 'Dirty working tree explicitly allowed');
    }
  }

  const status = failures.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'PASS';
  const risk_level = failures.length > 0 ? 3 : warnings.length > 0 ? 1 : 0;

  return {
    status,
    risk_level,
    checks,
    failures,
    warnings,
    next_actions,
    normalized,
  };
}

module.exports = {
  normalizeRunStatus,
  verifyCompletedRun,
};
