import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { readRequiredOptionValue } from '../lib/options.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';

const defaultBaseImages = Object.freeze({
  COMPARTMENT_CADDY_BUILDER_IMAGE: 'caddy:2.11.3-builder',
  COMPARTMENT_CADDY_RUNTIME_IMAGE: 'caddy:2.11.3',
  COMPARTMENT_GO_BUILD_IMAGE: 'golang:1.26.3-bookworm',
  COMPARTMENT_NODE_BUILD_IMAGE: 'node:24.14.0-bookworm',
  COMPARTMENT_NODE_RUNTIME_IMAGE: 'node:24.14.0-bookworm-slim',
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
  const envText = await readFile(resolve(input.envFilePath), 'utf8');
  const envValues = parseEnvFile(envText);
  const buildPlan = buildSelfHostedImageBuildPlan(envValues, input.env ?? process.env);

  for (const build of buildPlan) {
    await runDockerBuildWithRegistryRetry(input.repositoryRoot, build);
  }
}

function buildSelfHostedImageBuildPlan(envValues, env) {
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
        readRequiredEnvValue(envValues, 'COMPARTMENT_API_IMAGE'),
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
        readRequiredEnvValue(envValues, 'COMPARTMENT_EDGE_IMAGE'),
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
        readRequiredEnvValue(envValues, 'COMPARTMENT_WORKER_IMAGE'),
        '--file',
        'packages/worker/Dockerfile.self-hosted',
        '.',
      ],
      name: 'worker',
    },
    {
      args: [
        '--build-arg',
        `COMPARTMENT_NODE_RUNTIME_IMAGE=${readBaseImage(env, 'COMPARTMENT_NODE_RUNTIME_IMAGE')}`,
        '--tag',
        readRequiredEnvValue(envValues, 'COMPARTMENT_RUNTIME_PROBE_IMAGE'),
        '--file',
        'packages/node/Dockerfile.runtime-probe.self-hosted',
        '.',
      ],
      name: 'runtime-probe',
    },
    {
      args: [
        '--build-arg',
        `COMPARTMENT_CADDY_BUILDER_IMAGE=${readBaseImage(env, 'COMPARTMENT_CADDY_BUILDER_IMAGE')}`,
        '--build-arg',
        `COMPARTMENT_CADDY_RUNTIME_IMAGE=${readBaseImage(env, 'COMPARTMENT_CADDY_RUNTIME_IMAGE')}`,
        '--tag',
        readRequiredEnvValue(envValues, 'COMPARTMENT_CADDY_IMAGE'),
        '--file',
        'packages/edge/Dockerfile.caddy.self-hosted',
        '.',
      ],
      name: 'caddy',
    },
  ].map((build) => ({
    args: ['buildx', 'build', '--load', ...build.args],
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

function parseEnvFile(envText) {
  const values = {};

  for (const line of envText.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine === '' || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');
    if (separatorIndex > 0) {
      values[trimmedLine.slice(0, separatorIndex)] = trimmedLine.slice(separatorIndex + 1);
    }
  }

  return values;
}

function readBaseImage(env, variableName) {
  const imageRef = env[variableName] ?? defaultBaseImages[variableName];
  if (imageRef !== undefined) {
    return imageRef;
  }

  throw new Error(`Expected ${variableName} to be configured for self-hosted image builds.`);
}

function readRequiredEnvValue(envValues, variableName) {
  const value = envValues[variableName];
  if (value !== undefined && value.trim() !== '') {
    return value.trim();
  }

  throw new Error(`Expected ${variableName} in the self-hosted env file.`);
}

function readBuildSelfHostedImagesOptions(args) {
  const options = {
    envFilePath: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--env-file') {
      options.envFilePath = readRequiredOptionValue(args, ++index, '--env-file');
      continue;
    }

    throw new Error(`Unknown build self-hosted images argument: ${argument}`);
  }

  if (options.envFilePath === undefined) {
    throw new Error('Expected --env-file.');
  }

  return {
    envFilePath: options.envFilePath,
    env: process.env,
    repositoryRoot,
  };
}

async function main() {
  await buildSelfHostedImages(readBuildSelfHostedImagesOptions(process.argv.slice(2)));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
