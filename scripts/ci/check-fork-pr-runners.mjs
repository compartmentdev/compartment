import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readRepositoryRoot } from '../lib/repository-root.mjs';

const repoRoot = readRepositoryRoot(import.meta.url, 2);
const workflowDir = '.github/workflows';
const runsOnKey = /^(\s*)runs-on:\s*(.*)$/;
const forbiddenRunnerLabel = /\b(?:self-hosted|compartment-ci-deploy-e2e|hetzner-x86-container-dind-libatomic-5slot)\b/;

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
      continue;
    }

    for (let blockIndex = index + 1; blockIndex < lines.length; blockIndex += 1) {
      const blockLine = stripYamlComment(lines[blockIndex] ?? '');
      if (blockLine.trim() === '') {
        continue;
      }

      if (readIndent(blockLine) <= indent.length) {
        break;
      }

      if (hasForbiddenRunnerLabel(blockLine)) {
        return `${line.trim()} ${blockLine.trim()}`;
      }
    }
  }

  return undefined;
}

function hasForbiddenRunnerLabel(line) {
  return forbiddenRunnerLabel.test(line);
}

function startsRunsOnBlock(inlineValue) {
  const value = inlineValue.trim();
  return value === '' || hasUnclosedFlowCollection(value);
}

function hasUnclosedFlowCollection(value) {
  const opening = (value.match(/[[{]/g) ?? []).length;
  const closing = (value.match(/[\]}]/g) ?? []).length;
  return opening > closing;
}

function readIndent(line) {
  return line.length - line.trimStart().length;
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
