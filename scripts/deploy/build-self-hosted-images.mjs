import { spawn } from 'node:child_process';
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
  COMPARTMENT_CADDY_BASE_IMAGE: 'caddy:2.11.4-alpine',
  COMPARTMENT_CADDY_RUNTIME_IMAGE: 'alpine:3.22',
  COMPARTMENT_GO_BUILD_IMAGE: 'golang:1.26.5-bookworm',
  COMPARTMENT_NODE_BUILD_IMAGE: 'node:24.15.0-bookworm',
  COMPARTMENT_NODE_RUNTIME_IMAGE: 'node:24.15.0-bookworm-slim',
});
const dockerRateLimitRetryDelaysMs = Object.freeze([90_000, 180_000, 300_000]);
const capturedOutputTailMaxLength = 96_000;
const dockerRegistryRateLimitPatterns = [
  '429 Too Many Requests',
  'toomanyrequests',
  'rate exceeded',
  'too many requests',
];

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);

export async function buildSelfHostedImages(input) {
  const buildPlan = buildSelfHostedImageBuildPlan(
    input.imageRefsByServiceName,
    input.env ?? process.env,
    input.builderName,
  );

  for (const build of buildPlan) {
    await runDockerBuildWithRegistryRetry(input.repositoryRoot, build);
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
        `COMPARTMENT_CADDY_BASE_IMAGE=${readBaseImage(env, 'COMPARTMENT_CADDY_BASE_IMAGE')}`,
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
  return await new Promise((resolveCommand, rejectCommand) => {
    const child = spawn('docker', args, {
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
