import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { readRequiredOptionValue } from '../lib/options.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import {
  buildSelfHostedImageRefForRepository,
  defaultSelfHostedImageRepositoryPrefix,
  selfHostedRuntimeImageArtifacts,
} from './self-hosted-runtime-services.mjs';

const defaultBaseImages = Object.freeze({
  COMPARTMENT_CADDY_RUNTIME_IMAGE: 'alpine:3.22',
  COMPARTMENT_GO_BUILD_IMAGE: 'golang:1.26.6-bookworm',
  COMPARTMENT_NODE_BUILD_IMAGE: 'node:24.15.0-bookworm',
  COMPARTMENT_NODE_RUNTIME_IMAGE: 'node:24.15.0-bookworm-slim',
});
const dockerRateLimitRetryDelaysMs = Object.freeze([90_000, 180_000, 300_000]);
const capturedOutputTailMaxLength = 96_000;
const railpackBuilderImage =
  'ghcr.io/railwayapp/railpack-builder@sha256:007845e88b6c78b3bf57df7c2379c336589545fa241b047f6389ba2ca0344129';
const railpackRuntimeImage =
  'ghcr.io/railwayapp/railpack-runtime@sha256:122904a97579630033432d6d4652ad4eb8751b9680756a429ebc7d0942222083';
const dockerRegistryRateLimitPatterns = [
  '429 Too Many Requests',
  'toomanyrequests',
  'rate exceeded',
  'too many requests',
];
const repositoryRoot = readRepositoryRoot(import.meta.url, 2);

export async function buildSelfHostedImages(input) {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'compartment-self-hosted-images-'));
  try {
    const buildPlan = buildSelfHostedImageBuildPlan(
      input.imageRefsByServiceName,
      input.env ?? process.env,
      input.builderName,
    );

    for (const build of buildPlan) {
      await runDockerBuildWithRegistryRetry(input.repositoryRoot, build);
    }
    await buildBuildkitSeedImage(input, outputDirectory);
  } finally {
    await rm(outputDirectory, { force: true, recursive: true });
  }
}

async function buildBuildkitSeedImage(input, outputDirectory) {
  const contextDirectory = join(outputDirectory, 'buildkit-seed-context');
  await runRequiredCommand(input.repositoryRoot, 'sh', [
    'packages/worker/scripts/generate-buildkit-seed.sh',
    readRequiredImageRef(input.imageRefsByServiceName, 'worker'),
    railpackBuilderImage,
    railpackRuntimeImage,
    contextDirectory,
  ]);
  await runDockerBuildWithRegistryRetry(input.repositoryRoot, {
    args: [
      'buildx',
      'build',
      ...(input.builderName === undefined ? [] : ['--builder', input.builderName]),
      '--load',
      '--tag',
      readRequiredImageRef(input.imageRefsByServiceName, 'buildkit-seed'),
      '--file',
      'packages/worker/Dockerfile.buildkit-seed',
      contextDirectory,
    ],
    name: 'buildkit-seed',
  });
}

async function runRequiredCommand(repositoryRoot, command, args) {
  const result = await runCommandProcess(repositoryRoot, command, args);
  if (!result.ok) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function buildSelfHostedImageBuildPlan(imageRefsByServiceName, env, builderName) {
  const nodeArgs = [
    '--build-arg',
    `COMPARTMENT_NODE_BUILD_IMAGE=${readBaseImage(env, 'COMPARTMENT_NODE_BUILD_IMAGE')}`,
    '--build-arg',
    `COMPARTMENT_NODE_RUNTIME_IMAGE=${readBaseImage(env, 'COMPARTMENT_NODE_RUNTIME_IMAGE')}`,
  ];

  return [
    {
      args: [
        '--build-arg',
        `COMPARTMENT_GO_BUILD_IMAGE=${readBaseImage(env, 'COMPARTMENT_GO_BUILD_IMAGE')}`,
        '--tag',
        readRequiredImageRef(imageRefsByServiceName, 'dns01-solver'),
        '--file',
        'packages/managed-domain-dns01-solver/Dockerfile',
        '.',
      ],
      name: 'dns01-solver',
    },
    {
      args: [
        ...nodeArgs,
        '--tag',
        readRequiredImageRef(imageRefsByServiceName, 'api'),
        '--file',
        'packages/api/Dockerfile.self-hosted',
        '.',
      ],
      name: 'api',
    },
    {
      args: [
        ...nodeArgs,
        '--tag',
        readRequiredImageRef(imageRefsByServiceName, 'edge'),
        '--file',
        'packages/edge/Dockerfile.self-hosted',
        '.',
      ],
      name: 'edge',
    },
    {
      args: [
        ...nodeArgs,
        '--build-arg',
        `COMPARTMENT_GO_BUILD_IMAGE=${readBaseImage(env, 'COMPARTMENT_GO_BUILD_IMAGE')}`,
        '--tag',
        readRequiredImageRef(imageRefsByServiceName, 'worker'),
        '--file',
        'packages/worker/Dockerfile.self-hosted',
        '.',
      ],
      name: 'worker',
    },
    {
      args: [
        '--build-arg',
        `COMPARTMENT_CADDY_RUNTIME_IMAGE=${readBaseImage(env, 'COMPARTMENT_CADDY_RUNTIME_IMAGE')}`,
        '--tag',
        readRequiredImageRef(imageRefsByServiceName, 'caddy'),
        '--file',
        'packages/edge/Dockerfile.caddy.self-hosted',
        '.',
      ],
      name: 'caddy',
    },
  ].map((build) => ({
    args: [
      'buildx',
      'build',
      ...(builderName === undefined ? [] : ['--builder', builderName]),
      '--load',
      ...build.args,
    ],
    name: build.name,
  }));
}

async function runDockerBuildWithRegistryRetry(repositoryRoot, build) {
  const maxBuildAttempts = dockerRateLimitRetryDelaysMs.length + 1;

  for (let attemptIndex = 0; attemptIndex < maxBuildAttempts; attemptIndex += 1) {
    process.stdout.write(`Building self-hosted ${build.name} image.\n`);
    const result = await runDockerCommand(repositoryRoot, build.args);
    if (result.ok) {
      return;
    }

    const retryDelayMs = dockerRateLimitRetryDelaysMs[attemptIndex];
    if (!isDockerRegistryRateLimitFailure(result.outputTail) || retryDelayMs === undefined) {
      throw new Error(`Command failed: docker ${build.args.join(' ')}`);
    }

    process.stderr.write(
      `Docker registry rate limit while building self-hosted ${build.name} image; retrying in ${Math.round(
        retryDelayMs / 1000,
      )}s.\n`,
    );
    await delay(retryDelayMs);
  }
}

async function runDockerCommand(repositoryRoot, args) {
  return await runCommandProcess(repositoryRoot, 'docker', args);
}

async function runCommandProcess(repositoryRoot, command, args) {
  return await new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let outputTail = '';

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      outputTail = appendOutputTail(outputTail, chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      outputTail = appendOutputTail(outputTail, chunk);
    });
    child.once('error', rejectCommand);
    child.once('close', (code) => {
      resolveCommand({
        ok: code === 0,
        outputTail,
      });
    });
  });
}

function appendOutputTail(outputTail, chunk) {
  const nextOutputTail = `${outputTail}${chunk.toString('utf8')}`;
  return nextOutputTail.length > capturedOutputTailMaxLength
    ? nextOutputTail.slice(nextOutputTail.length - capturedOutputTailMaxLength)
    : nextOutputTail;
}

function isDockerRegistryRateLimitFailure(output) {
  const normalizedOutput = output.toLowerCase();
  return dockerRegistryRateLimitPatterns.some((pattern) => normalizedOutput.includes(pattern.toLowerCase()));
}

function readBaseImage(env, variableName) {
  const imageRef = env[variableName] ?? defaultBaseImages[variableName];
  if (imageRef !== undefined) {
    return imageRef;
  }

  throw new Error(`Expected ${variableName} to be configured for self-hosted image builds.`);
}

function readRequiredImageRef(imageRefsByServiceName, serviceName) {
  const imageRef = imageRefsByServiceName[serviceName]?.trim();
  if (imageRef !== undefined && imageRef !== '') {
    return imageRef;
  }

  throw new Error(`Expected an image ref for ${serviceName}.`);
}

function readBuildSelfHostedImagesOptions(args) {
  const options = {
    repositoryPrefix: defaultSelfHostedImageRepositoryPrefix,
    tag: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--repository-prefix') {
      options.repositoryPrefix = readRequiredOptionValue(args, ++index, '--repository-prefix');
      continue;
    }
    if (argument === '--tag') {
      options.tag = readRequiredOptionValue(args, ++index, '--tag');
      continue;
    }

    throw new Error(`Unknown build self-hosted images argument: ${argument}`);
  }

  if (options.tag === undefined) {
    throw new Error('Expected --tag.');
  }

  return {
    env: process.env,
    imageRefsByServiceName: Object.fromEntries(
      selfHostedRuntimeImageArtifacts.map((serviceName) => [
        serviceName,
        buildSelfHostedImageRefForRepository(serviceName, options.tag, options.repositoryPrefix),
      ]),
    ),
    repositoryRoot,
  };
}

async function main() {
  await buildSelfHostedImages(readBuildSelfHostedImagesOptions(process.argv.slice(2)));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
