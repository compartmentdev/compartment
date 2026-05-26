import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parse } from 'yaml';

import { readRepositoryRoot } from '../lib/repository-root.mjs';

const repoRoot = readRepositoryRoot(import.meta.url, 2);
const workflowDir = '.github/workflows';
const forbiddenRunnerLabels = new Set([
  'self-hosted',
  'compartment-ci-deploy-e2e',
  'hetzner-x86-container-dind-libatomic-5slot',
]);
const matrixReferencePattern = /\bmatrix\.([A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*)/gu;

export function findForkPullRequestRunnerValidationErrors(path, content) {
  const workflow = parse(content);
  const jobs = isRecord(workflow) ? workflow.jobs : undefined;
  const errors = [];

  if (!isRecord(jobs)) {
    return errors;
  }

  for (const [jobName, job] of Object.entries(jobs)) {
    if (!isRecord(job)) {
      continue;
    }

    const runsOn = job['runs-on'];
    for (const label of findForbiddenRunnerLabels(runsOn)) {
      errors.push(`${path}: job "${jobName}" must not hard-code self-hosted runner label "${label}" in runs-on.`);
    }

    const matrix = isRecord(job.strategy) ? job.strategy.matrix : undefined;
    if (!isRecord(matrix)) {
      continue;
    }

    for (const reference of readMatrixRunsOnReferences(runsOn)) {
      for (const label of findForbiddenMatrixRunnerLabels(matrix, reference)) {
        errors.push(
          `${path}: job "${jobName}" must not route runs-on through matrix reference "${reference}" to self-hosted runner label "${label}".`,
        );
      }
    }
  }

  return errors;
}

function main() {
  const errors = [];

  for (const entry of readdirSync(join(repoRoot, workflowDir))) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) {
      continue;
    }

    const path = `${workflowDir}/${entry}`;
    const content = readFileSync(join(repoRoot, path), 'utf8');
    errors.push(...findForkPullRequestRunnerValidationErrors(path, content));
  }

  if (errors.length > 0) {
    throw new Error(`Fork PR runner check failed.\n${errors.join('\n')}`);
  }
}

function findForbiddenRunnerLabels(value) {
  const labels = new Set();
  collectForbiddenRunnerLabels(value, labels);
  return [...labels];
}

function collectForbiddenRunnerLabels(value, labels) {
  if (typeof value === 'string') {
    const normalizedValue = value.trim();
    if (forbiddenRunnerLabels.has(normalizedValue)) {
      labels.add(normalizedValue);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectForbiddenRunnerLabels(entry, labels);
    }
    return;
  }

  if (isRecord(value)) {
    for (const entry of Object.values(value)) {
      collectForbiddenRunnerLabels(entry, labels);
    }
  }
}

function readMatrixRunsOnReferences(value) {
  const references = new Set();
  collectMatrixRunsOnReferences(value, references);
  return [...references];
}

function collectMatrixRunsOnReferences(value, references) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(matrixReferencePattern)) {
      const reference = match[1];
      if (reference !== undefined) {
        references.add(reference);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectMatrixRunsOnReferences(entry, references);
    }
    return;
  }

  if (isRecord(value)) {
    for (const entry of Object.values(value)) {
      collectMatrixRunsOnReferences(entry, references);
    }
  }
}

function findForbiddenMatrixRunnerLabels(matrix, reference) {
  const labels = new Set();
  const directValue = readNestedProperty(matrix, reference);
  collectForbiddenRunnerLabels(directValue, labels);

  if (Array.isArray(matrix.include)) {
    for (const includeEntry of matrix.include) {
      if (isRecord(includeEntry)) {
        collectForbiddenRunnerLabels(readNestedProperty(includeEntry, reference), labels);
      }
    }
  }

  return [...labels];
}

function readNestedProperty(record, path) {
  let value = record;

  for (const segment of path.split('.')) {
    if (!isRecord(value)) {
      return undefined;
    }
    value = value[segment];
  }

  return value;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
