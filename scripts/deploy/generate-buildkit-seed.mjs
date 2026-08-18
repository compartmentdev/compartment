import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

import { readRequiredOptionValue } from '../lib/options.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const railpackImagesPath = join(repositoryRoot, 'deploy/chart/compartment/railpack-images.json');
const commandOutputTailMaxLength = 96_000;

export async function generateBuildkitSeedContext(input) {
  await assertMissingOutputDirectory(input.outputDirectory);
  await mkdir(input.outputDirectory, { recursive: true });
  const token = randomUUID().replaceAll('-', '');
  const containerName = `compartment-buildkit-seed-${token}`;
  const volumeName = `compartment-buildkit-seed-${token}`;
  const railpackImages = await readRailpackImages();

  try {
    await runRequiredCommand('docker', ['volume', 'create', volumeName]);
    await runRequiredCommand('docker', [
      'run',
      '--detach',
      '--name',
      containerName,
      '--privileged',
      '--user',
      '0',
      '--volume',
      `${volumeName}:/seed`,
      '--entrypoint',
      '/usr/local/bin/buildkitd',
      input.workerImage,
      '--root',
      '/seed/state',
      '--addr',
      'unix:///run/buildkit/buildkitd.sock',
      '--oci-worker=true',
      '--oci-worker-binary=/usr/local/bin/buildkit-runc-gvisor',
      '--oci-worker-gc=false',
      '--oci-worker-snapshotter=overlayfs',
    ]);
    await waitForBuildkit(containerName);
    await runRequiredCommand('docker', ['exec', containerName, 'mkdir', '-p', '/tmp/seed-context']);
    await runRequiredCommand(
      'docker',
      ['exec', '--interactive', containerName, 'tee', '/tmp/seed-context/Dockerfile'],
      `FROM ${railpackImages.builder}\nRUN true\n`,
    );
    await runRequiredCommand('docker', [
      'exec',
      containerName,
      'buildctl',
      '--addr',
      'unix:///run/buildkit/buildkitd.sock',
      'build',
      '--progress=plain',
      '--frontend',
      'dockerfile.v0',
      '--local',
      'context=/tmp/seed-context',
      '--local',
      'dockerfile=/tmp/seed-context',
    ]);
    await pruneMutableBuildkitCache(containerName);
    await assertBuildkitCacheIsImmutable(containerName);
    await runRequiredCommand('docker', ['stop', containerName]);
    await runRequiredCommand('docker', [
      'run',
      '--rm',
      '--user',
      '0',
      '--volume',
      `${volumeName}:/seed`,
      '--entrypoint',
      'node',
      input.workerImage,
      '/usr/local/bin/package-buildkit-seed',
      railpackImages.builder,
      railpackImages.runtime,
    ]);
    await streamCommandToFile(
      'docker',
      [
        'run',
        '--rm',
        '--user',
        '0',
        '--volume',
        `${volumeName}:/seed:ro`,
        '--entrypoint',
        'tar',
        input.workerImage,
        '--xattrs',
        '--numeric-owner',
        '-C',
        '/',
        '-cf',
        '-',
        'seed',
      ],
      join(input.outputDirectory, 'seed.tar'),
    );
  } catch (error) {
    await rm(input.outputDirectory, { force: true, recursive: true });
    throw error;
  } finally {
    await runOptionalCommand('docker', ['rm', '--force', containerName]);
    await runOptionalCommand('docker', ['volume', 'rm', '--force', volumeName]);
  }
}

async function readRailpackImages() {
  const parsed = JSON.parse(await readFile(railpackImagesPath, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof parsed.builder !== 'string' ||
    typeof parsed.runtime !== 'string'
  ) {
    throw new Error(`Invalid Railpack image pins in ${railpackImagesPath}.`);
  }
  return { builder: parsed.builder, runtime: parsed.runtime };
}

async function assertMissingOutputDirectory(outputDirectory) {
  try {
    await access(outputDirectory);
  } catch {
    return;
  }
  throw new Error(`BuildKit seed output directory already exists: ${outputDirectory}`);
}

async function waitForBuildkit(containerName) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await runCommand('docker', [
      'exec',
      containerName,
      'buildctl',
      '--addr',
      'unix:///run/buildkit/buildkitd.sock',
      'debug',
      'workers',
    ]);
    if (result.ok) {
      return;
    }
    await delay(1_000);
  }
  await runOptionalCommand('docker', ['logs', containerName]);
  throw new Error('Timed out waiting for seed BuildKit.');
}

async function assertBuildkitCacheIsImmutable(containerName) {
  const records = await readBuildkitCacheRecords(containerName);
  if (records.length === 0 || records.some((record) => record.mutable !== false)) {
    throw new Error('BuildKit seed cache must contain only immutable records.');
  }
}

async function pruneMutableBuildkitCache(containerName) {
  const records = await readBuildkitCacheRecords(containerName);
  for (const record of records) {
    if (record.mutable === true && typeof record.id === 'string') {
      await runRequiredCommand('docker', [
        'exec',
        containerName,
        'buildctl',
        '--addr',
        'unix:///run/buildkit/buildkitd.sock',
        'prune',
        '--all',
        '--filter',
        `id==${record.id}`,
      ]);
    }
  }
}

async function readBuildkitCacheRecords(containerName) {
  const result = await runCommand(
    'docker',
    [
      'exec',
      containerName,
      'buildctl',
      '--addr',
      'unix:///run/buildkit/buildkitd.sock',
      'du',
      '--format',
      '{{json .}}',
    ],
    undefined,
    false,
  );
  if (!result.ok) {
    throw new Error(`Failed to inspect BuildKit seed cache:\n${result.outputTail}`);
  }
  const records = JSON.parse(result.stdout);
  if (!Array.isArray(records)) {
    throw new Error('BuildKit seed cache inspection returned an invalid response.');
  }
  return records;
}

async function streamCommandToFile(command, args, outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  const output = createWriteStream(outputPath, { flags: 'wx' });
  const child = spawn(command, args, { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let outputTail = '';
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    outputTail = appendOutputTail(outputTail, chunk);
  });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed: ${command} ${args.join(' ')}\n${outputTail}`));
      }
    });
  });
  await Promise.all([pipeline(child.stdout, output), completion]);
}

async function runRequiredCommand(command, args, input) {
  const result = await runCommand(command, args, input);
  if (!result.ok) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}\n${result.outputTail}`);
  }
}

async function runOptionalCommand(command, args) {
  await runCommand(command, args);
}

async function runCommand(command, args, input, echoStdout = true) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let outputTail = '';
    let stdout = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        if (stream === child.stdout) {
          stdout += chunk;
        }
        if (stream !== child.stdout || echoStdout) {
          const target = stream === child.stdout ? process.stdout : process.stderr;
          target.write(chunk);
        }
        outputTail = appendOutputTail(outputTail, chunk);
      });
    }
    child.once('error', reject);
    child.once('close', (code) => resolve({ ok: code === 0, outputTail, stdout }));
    if (input !== undefined) {
      child.stdin.end(input);
    }
  });
}

function appendOutputTail(outputTail, chunk) {
  const next = `${outputTail}${chunk.toString('utf8')}`;
  return next.length > commandOutputTailMaxLength ? next.slice(-commandOutputTailMaxLength) : next;
}

function readOptions(args) {
  const options = { outputDirectory: undefined, workerImage: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--output-directory') {
      options.outputDirectory = readRequiredOptionValue(args, ++index, argument);
    } else if (argument === '--worker-image') {
      options.workerImage = readRequiredOptionValue(args, ++index, argument);
    } else {
      throw new Error(`Unknown BuildKit seed option: ${argument}`);
    }
  }
  if (options.outputDirectory === undefined || options.workerImage === undefined) {
    throw new Error('Expected --worker-image and --output-directory.');
  }
  return options;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generateBuildkitSeedContext(readOptions(process.argv.slice(2)));
}
