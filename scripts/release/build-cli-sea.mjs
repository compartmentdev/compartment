import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

import { runCommand } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';

const seaBlobAssetName = 'NODE_SEA_BLOB';
// Required Node SEA sentinel fuse from the official Node/postject flow.
const seaFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const bundleEntryPath = 'packages/cli/dist/bin.js';
const bundledKubernetesChartAssetName = 'compartment-chart.tgz';
const repositoryRoot = readRepositoryRoot(import.meta.url, 2);

async function main() {
  const options = readCliSeaBuildOptions(process.argv.slice(2), repositoryRoot);
  assertSupportedCliSeaTarget();
  const buildDirectory = await mkdtemp(resolve(tmpdir(), 'compartment-cli-sea-'));

  try {
    buildCliPackage(repositoryRoot);

    const bundlePath = resolve(buildDirectory, 'bundle', 'index.js');
    const buildInfoPath = resolve(buildDirectory, 'cli-build-info.json');
    const chartArchivePath = resolve(buildDirectory, bundledKubernetesChartAssetName);
    const seaBlobPath = resolve(buildDirectory, 'compartment.blob');
    const seaConfigPath = resolve(buildDirectory, 'sea-config.json');
    const outputBinaryPath = resolve(options.outputDirectory, 'compartment');

    await mkdir(options.outputDirectory, { recursive: true });
    bundleCliEntry(repositoryRoot, dirname(bundlePath));
    createKubernetesChartArchive(chartArchivePath);
    await writeBuildInfo(buildInfoPath, options);
    await writeSeaConfig(seaConfigPath, seaBlobPath, buildInfoPath, bundlePath, chartArchivePath);
    generateSeaBlob(repositoryRoot, seaConfigPath);
    await copyFile(process.execPath, outputBinaryPath);
    removeMacOsSignature(outputBinaryPath);
    injectSeaBlob(repositoryRoot, outputBinaryPath, seaBlobPath);
    signMacOsBinary(outputBinaryPath);
    await chmod(outputBinaryPath, 0o755);

    process.stdout.write(`${outputBinaryPath}\n`);
  } finally {
    await rm(buildDirectory, { force: true, recursive: true });
  }
}

function readCliSeaBuildOptions(args, repositoryRoot) {
  const options = {
    buildCommitSha: undefined,
    distributionChannel: undefined,
    outputDirectory: resolve(repositoryRoot, '.compartment/cli-dist'),
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--distribution-channel') {
      options.distributionChannel = readRequiredCliSeaOptionValue(args, ++index, '--distribution-channel');
      continue;
    }

    if (argument === '--build-commit-sha') {
      options.buildCommitSha = readRequiredCliSeaOptionValue(args, ++index, '--build-commit-sha');
      continue;
    }

    if (argument === '--output-dir') {
      const outputDirectory = readRequiredCliSeaOptionValue(args, ++index, '--output-dir');
      options.outputDirectory = resolve(repositoryRoot, outputDirectory);
      continue;
    }

    throw new Error(`Unknown CLI SEA build argument: ${argument}`);
  }

  if (
    options.distributionChannel === 'source' ||
    options.distributionChannel === 'main' ||
    options.distributionChannel === 'release'
  ) {
    return {
      buildCommitSha: options.buildCommitSha,
      distributionChannel: options.distributionChannel,
      outputDirectory: options.outputDirectory,
    };
  }

  throw new Error('Expected --distribution-channel (source|main|release) when building the CLI SEA binary.');
}

function readRequiredCliSeaOptionValue(args, index, optionName) {
  const value = args[index];
  if (typeof value === 'string' && value !== '') {
    return value;
  }

  throw new Error(`Expected a value after ${optionName}.`);
}

function assertSupportedCliSeaTarget() {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    return;
  }

  throw new Error(`Unsupported CLI SEA platform: ${process.platform}.`);
}

function buildCliPackage(repositoryRoot) {
  runCommand('pnpm', ['build', '--filter=@compartment/cli'], repositoryRoot);
}

function bundleCliEntry(repositoryRoot, bundleDirectory) {
  runCommand(
    'pnpm',
    ['exec', 'ncc', 'build', resolve(repositoryRoot, bundleEntryPath), '--out', bundleDirectory],
    repositoryRoot,
  );
}

async function writeBuildInfo(buildInfoPath, options) {
  await writeFile(
    buildInfoPath,
    `${JSON.stringify(
      {
        ...(options.buildCommitSha !== undefined ? { buildCommitSha: options.buildCommitSha } : {}),
        cliVersion: await readCliVersion(),
        distributionChannel: options.distributionChannel,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function readCliVersion() {
  const cliPackageJsonPath = resolve(repositoryRoot, 'packages/cli/package.json');
  const cliPackageJson = JSON.parse(await readFile(cliPackageJsonPath, 'utf8'));
  const cliVersion = cliPackageJson.version;

  if (typeof cliVersion === 'string' && cliVersion !== '') {
    return cliVersion;
  }

  throw new Error(`Expected ${cliPackageJsonPath} to define a non-empty version.`);
}

function createKubernetesChartArchive(chartArchivePath) {
  runCommand(
    'tar',
    ['-czf', chartArchivePath, '-C', resolve(repositoryRoot, 'deploy/chart'), 'compartment'],
    repositoryRoot,
    { ...process.env, COPYFILE_DISABLE: '1' },
  );
}

async function writeSeaConfig(seaConfigPath, seaBlobPath, buildInfoPath, bundlePath, chartArchivePath) {
  const seaConfig = {
    assets: {
      'cli-build-info.json': buildInfoPath,
      [bundledKubernetesChartAssetName]: chartArchivePath,
    },
    disableExperimentalSEAWarning: true,
    main: bundlePath,
    output: seaBlobPath,
    useCodeCache: false,
    useSnapshot: false,
  };

  await writeFile(seaConfigPath, `${JSON.stringify(seaConfig, null, 2)}\n`, 'utf8');
}

function generateSeaBlob(repositoryRoot, seaConfigPath) {
  runCommand('node', ['--experimental-sea-config', seaConfigPath], repositoryRoot);
}

function removeMacOsSignature(binaryPath) {
  if (process.platform === 'darwin') {
    runCommand('codesign', ['--remove-signature', binaryPath], undefined);
  }
}

function injectSeaBlob(repositoryRoot, outputBinaryPath, seaBlobPath) {
  const postjectArgs = [
    'exec',
    'postject',
    outputBinaryPath,
    seaBlobAssetName,
    seaBlobPath,
    '--sentinel-fuse',
    seaFuse,
  ];
  if (process.platform === 'darwin') {
    postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  }

  runCommand('pnpm', postjectArgs, repositoryRoot);
}

function signMacOsBinary(binaryPath) {
  if (process.platform === 'darwin') {
    runCommand('codesign', ['--sign', '-', binaryPath], undefined);
  }
}

await main();
