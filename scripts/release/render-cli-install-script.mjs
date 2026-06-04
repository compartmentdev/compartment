import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { readRequiredOptionValue } from '../lib/options.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';

const releaseRepositoryPlaceholder = '__COMPARTMENT_RELEASES_REPOSITORY__';
const defaultReleaseVersionPlaceholder = '__COMPARTMENT_DEFAULT_RELEASE_VERSION__';
const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const releaseRepositoryPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/u;

async function main() {
  const options = readInstallerRenderOptions(process.argv.slice(2), repositoryRoot);
  const templatePath = resolve(repositoryRoot, 'scripts/release/install-cli.sh.template');
  const templateText = await readFile(templatePath, 'utf8');
  const renderedText = templateText
    .replaceAll(releaseRepositoryPlaceholder, options.releaseRepository)
    .replaceAll(defaultReleaseVersionPlaceholder, options.defaultReleaseVersion);

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, renderedText, 'utf8');
}

function readInstallerRenderOptions(args, repositoryRoot) {
  let defaultReleaseVersion = '';
  let releaseRepository;
  let outputPath;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--repository') {
      releaseRepository = readRequiredOptionValue(args, ++index, '--repository');
      continue;
    }

    if (argument === '--default-version') {
      defaultReleaseVersion = readRequiredOptionValue(args, ++index, '--default-version');
      continue;
    }

    if (argument === '--output') {
      outputPath = resolve(repositoryRoot, readRequiredOptionValue(args, ++index, '--output'));
      continue;
    }

    throw new Error(`Unknown installer render argument: ${argument}`);
  }

  if (!/^[A-Za-z0-9._+-]*$/u.test(defaultReleaseVersion)) {
    throw new Error('Expected --default-version to contain only release-version characters.');
  }

  if (typeof releaseRepository === 'string' && !releaseRepositoryPattern.test(releaseRepository)) {
    throw new Error('Expected --repository to use the owner/repo format with only GitHub repository characters.');
  }

  if (
    typeof releaseRepository === 'string' &&
    releaseRepository !== '' &&
    typeof outputPath === 'string' &&
    outputPath !== ''
  ) {
    return {
      defaultReleaseVersion,
      releaseRepository,
      outputPath,
    };
  }

  throw new Error(
    'Expected --repository <owner/repo>, optional --default-version <version>, and --output <path> when rendering the CLI installer.',
  );
}

await main();
