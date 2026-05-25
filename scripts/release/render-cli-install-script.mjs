import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { readRequiredOptionValue } from '../lib/options.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';

const releaseRepositoryPlaceholder = '__COMPARTMENT_RELEASES_REPOSITORY__';
const repositoryRoot = readRepositoryRoot(import.meta.url, 2);

async function main() {
  const options = readInstallerRenderOptions(process.argv.slice(2), repositoryRoot);
  const templatePath = resolve(repositoryRoot, 'scripts/release/install-cli.sh.template');
  const templateText = await readFile(templatePath, 'utf8');
  const renderedText = templateText.replaceAll(releaseRepositoryPlaceholder, options.releaseRepository);

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, renderedText, 'utf8');
}

function readInstallerRenderOptions(args, repositoryRoot) {
  let releaseRepository;
  let outputPath;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--repository') {
      releaseRepository = readRequiredOptionValue(args, ++index, '--repository');
      continue;
    }

    if (argument === '--output') {
      outputPath = resolve(repositoryRoot, readRequiredOptionValue(args, ++index, '--output'));
      continue;
    }

    throw new Error(`Unknown installer render argument: ${argument}`);
  }

  if (typeof releaseRepository === 'string' && releaseRepository !== '') {
    if (typeof outputPath === 'string' && outputPath !== '') {
      return {
        releaseRepository,
        outputPath,
      };
    }
  }

  throw new Error('Expected --repository <owner/repo> and --output <path> when rendering the CLI installer.');
}

await main();
