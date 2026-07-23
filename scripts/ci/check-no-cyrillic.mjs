import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readRepositoryRoot } from '../lib/repository-root.mjs';

const repoRoot = readRepositoryRoot(import.meta.url, 2);
const cyrillicCharacter = /[\u0400-\u04FF]/u;

function listTrackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  return output.split('\0').filter((entry) => entry.length > 0);
}

function findCyrillicLines(content) {
  const lines = content.split('\n');
  const matches = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (cyrillicCharacter.test(lines[index] ?? '')) {
      matches.push(index + 1);
    }
  }

  return matches;
}

function main() {
  const errors = [];

  for (const file of listTrackedFiles()) {
    const buffer = readFileSync(join(repoRoot, file));
    if (buffer.includes(0)) {
      continue;
    }
    for (const line of findCyrillicLines(buffer.toString('utf8'))) {
      errors.push(`${file}:${line}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Repository content must be written in English. Cyrillic text found:\n${errors.join('\n')}`,
    );
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
