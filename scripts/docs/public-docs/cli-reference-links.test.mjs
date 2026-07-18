import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readRepositoryRoot } from '../../lib/repository-root.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 3);
const cliReferencePath = join(repositoryRoot, 'public-docs/src/content/docs/reference/cli-reference.md');
const generatedCliRoot = join(repositoryRoot, 'public-docs/src/content/docs/reference/generated/cli');

describe('public CLI reference links', () => {
  it('points every generated command link at an existing reference page', async () => {
    const reference = await readFile(cliReferencePath, 'utf8');
    const commandNames = [...reference.matchAll(/\/reference\/generated\/cli\/([^/]+)\//gu)].map((match) => match[1]);
    const missing = [];
    for (const commandName of commandNames) {
      try {
        await access(join(generatedCliRoot, `${commandName}.md`));
      } catch {
        missing.push(commandName);
      }
    }

    expect(missing).toEqual([]);
  });
});
