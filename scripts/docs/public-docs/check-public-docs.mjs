import { execFileAsync } from './exec-file.mjs';
import { readGeneratedSnapshot } from './public-docs-files.mjs';
import { generatePublicDocs } from './generate-public-docs.mjs';
import { runMain } from '../../lib/run-main.mjs';

export async function checkPublicDocs() {
  const beforeSnapshot = await readGeneratedSnapshot();
  await generatePublicDocs();
  const afterFirstSnapshot = await readGeneratedSnapshot();
  await generatePublicDocs();
  const afterSecondSnapshot = await readGeneratedSnapshot();

  if (afterFirstSnapshot !== afterSecondSnapshot) {
    throw new Error('Generated public docs are not deterministic across repeated runs.');
  }

  if (beforeSnapshot !== afterFirstSnapshot) {
    throw new Error(
      'Generated public docs were stale. Run `pnpm docs:generate`, review the changes under public-docs/src/content/docs/reference/generated/, and commit them.',
    );
  }

  await execFileAsync('pnpm', ['--dir', 'public-docs', 'build'], { cwd: process.cwd() });
}

export async function main() {
  await checkPublicDocs();
}

runMain(import.meta.url, process.argv[1], main);
