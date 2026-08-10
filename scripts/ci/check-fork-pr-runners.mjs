import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const repoRoot = readRepositoryRoot(import.meta.url, 2);
const workflowDir = '.github/workflows';
const runsOnKey = /^(\s*)runs-on:\s*(.*)$/;
const matrixRunnerKey = /^(\s*)runner:\s*(.*)$/;
const matrixRunnerExpression = /\bmatrix\.runner\b/;
const yamlBlockScalar = /^[>|][+-]?$/;
const forbiddenRunnerLabel = /\b(?:self-hosted|compartment-ci-deploy-e2e)\b/;

function findForbiddenRunsOnLine(content) {
  const lines = content.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = stripYamlComment(lines[index] ?? '');
    const runsOnMatch = runsOnKey.exec(line);
    if (runsOnMatch === null) {
      continue;
    }

    const [, indent, inlineValue] = runsOnMatch;
    if (hasForbiddenRunnerLabel(inlineValue)) {
      return line.trim();
    }

    if (!startsRunsOnBlock(inlineValue)) {
      if (matrixRunnerExpression.test(inlineValue)) {
        const badMatrixLine = findForbiddenMatrixRunnerLine(lines, index, findParentBlockIndent(lines, index));
        if (badMatrixLine !== undefined) {
          return `${line.trim()} ${badMatrixLine.trim()}`;
        }
      }
      continue;
    }

    const badBlockLine = findForbiddenContinuationLine(lines, index, indent.length);
    if (badBlockLine !== undefined) {
      return `${line.trim()} ${badBlockLine.trim()}`;
    }
  }

  return undefined;
}

function findForbiddenContinuationLine(lines, startIndex, parentIndent) {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = stripYamlComment(lines[index] ?? '');
    if (line.trim() === '') {
      continue;
    }

    if (readIndent(line) <= parentIndent) {
      return undefined;
    }

    if (hasForbiddenRunnerLabel(line)) {
      return line;
    }
  }

  return undefined;
}

function findForbiddenMatrixRunnerLine(lines, runsOnIndex, jobIndent) {
  for (let index = runsOnIndex + 1; index < lines.length; index += 1) {
    const line = stripYamlComment(lines[index] ?? '');
    if (line.trim() === '') {
      continue;
    }

    if (readIndent(line) <= jobIndent) {
      return undefined;
    }

    const matrixRunnerMatch = matrixRunnerKey.exec(line);
    if (matrixRunnerMatch === null) {
      continue;
    }

    const [, indent, value] = matrixRunnerMatch;
    if (hasForbiddenRunnerLabel(value)) {
      return line;
    }

    if (!startsRunsOnBlock(value)) {
      continue;
    }

    const badBlockLine = findForbiddenContinuationLine(lines, index, indent.length);
    if (badBlockLine !== undefined) {
      return `${line.trim()} ${badBlockLine.trim()}`;
    }
  }

  return undefined;
}

function hasForbiddenRunnerLabel(line) {
  return forbiddenRunnerLabel.test(line);
}

function startsRunsOnBlock(inlineValue) {
  const value = inlineValue.trim();
  return value === '' || yamlBlockScalar.test(value) || hasUnclosedFlowCollection(value);
}

function hasUnclosedFlowCollection(value) {
  const opening = (value.match(/[[{]/g) ?? []).length;
  const closing = (value.match(/[\]}]/g) ?? []).length;
  return opening > closing;
}

function readIndent(line) {
  return line.length - line.trimStart().length;
}

function findParentBlockIndent(lines, childIndex) {
  const childIndent = readIndent(stripYamlComment(lines[childIndex] ?? ''));

  for (let index = childIndex - 1; index >= 0; index -= 1) {
    const line = stripYamlComment(lines[index] ?? '');
    if (line.trim() === '') {
      continue;
    }

    const indent = readIndent(line);
    if (indent < childIndent) {
      return indent;
    }
  }

  return -1;
}

function stripYamlComment(line) {
  const commentIndex = line.indexOf('#');
  return commentIndex === -1 ? line : line.slice(0, commentIndex);
}

function main() {
  const errors = [];

  for (const entry of readdirSync(join(repoRoot, workflowDir))) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) {
      continue;
    }

    const path = `${workflowDir}/${entry}`;
    const content = readFileSync(join(repoRoot, path), 'utf8');
    const badLine = findForbiddenRunsOnLine(content);

    if (badLine !== undefined) {
      errors.push(`${path}: self-hosted runner must be selected dynamically, not hard-coded: ${badLine.trim()}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Fork PR runner check failed.\n${errors.join('\n')}`);
  }
}

runMain(import.meta.url, process.argv[1], main);
