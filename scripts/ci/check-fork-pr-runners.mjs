import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readRepositoryRoot } from '../lib/repository-root.mjs';

const repoRoot = readRepositoryRoot(import.meta.url, 2);
const workflowDir = '.github/workflows';
const forbiddenRunsOn =
  /\bruns-on:\s*(?:\[.*\b(?:self-hosted|compartment-ci-deploy-e2e|hetzner-x86-container-dind-libatomic-5slot)\b.*]|\b(?:self-hosted|compartment-ci-deploy-e2e|hetzner-x86-container-dind-libatomic-5slot)\b)/;

function main() {
  const errors = [];

  for (const entry of readdirSync(join(repoRoot, workflowDir))) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) {
      continue;
    }

    const path = `${workflowDir}/${entry}`;
    const content = readFileSync(join(repoRoot, path), 'utf8');
    const badLine = content.split('\n').find((line) => forbiddenRunsOn.test(line));

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
