import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';

import { captureCommand, runCommandAsync } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';
import { readPlatformK3dEnvironment } from './platform-k3d-e2e.mjs';
import {
  buildPlatformK3dShardEnvironment,
  readPlatformK3dShard,
  readPlatformK3dShardSuites,
  registerPlatformK3dSignalCleanup,
  runWithPlatformK3dCleanup,
} from './platform-k3d-e2e-shard-support.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const lifecycleScript = join(repositoryRoot, 'scripts/deploy/platform-k3d-e2e.mjs');
const diagnosticsScript = join(repositoryRoot, 'scripts/deploy/collect-platform-k3d-e2e-diagnostics.mjs');
const networkPolicyGateScript = join(repositoryRoot, 'packages/kube-runtime/test/network-policy-enforcement-check.sh');
const productLogGateScript = join(repositoryRoot, 'scripts/deploy/run-platform-k3d-product-log-gate.mjs');
const retainedStateGateScript = join(repositoryRoot, 'scripts/deploy/run-platform-k3d-retained-state-gate.mjs');
const networkPolicySamplerScript = join(repositoryRoot, 'scripts/deploy/sample-platform-k3d-network-policies.mjs');
async function runShard(shardName) {
  const env = buildPlatformK3dShardEnvironment(shardName);
  const platformEnvironment = readPlatformK3dEnvironment(env);
  const suites = readPlatformK3dShardSuites(shardName);
  const diagnosticsPath = join(repositoryRoot, env.COMPARTMENT_E2E_DIAGNOSTICS_PATH);
  rmSync(diagnosticsPath, { force: true, recursive: true });
  let cleanupPromise;
  const cleanup = async () => {
    cleanupPromise ??= (async () => {
      try {
        await runCommandAsync(process.execPath, [lifecycleScript, 'down'], repositoryRoot, env);
      } finally {
        rmSync(join(repositoryRoot, env.COMPARTMENT_E2E_UPDATE_VALUES_PATH), { force: true });
      }
    })();
    await cleanupPromise;
  };
  const commandAbortController = new globalThis.AbortController();
  let executionPromise;
  const unregisterSignals = registerPlatformK3dSignalCleanup(
    () => commandAbortController.abort(),
    async () => await executionPromise,
  );
  try {
    executionPromise = runWithPlatformK3dCleanup({
      cleanup,
      execute: async () => {
        await buildCliArtifact(env, commandAbortController.signal);
        await startPlatform(env, commandAbortController.signal);
        if (suites.includes('system-update')) {
          await prepareSystemUpdateBaseline(env, commandAbortController.signal);
        }
        // An end-state dump cannot tell a policy that was wrong at the failing dial from one that
        // was only wrong afterwards, so the series runs alongside the suites.
        const sampler = startNetworkPolicySampler(env, diagnosticsPath);
        try {
          await runShardSuites(
            suites,
            env,
            platformEnvironment.platformOwnerEnvironmentPath,
            commandAbortController.signal,
          );
        } finally {
          sampler.kill('SIGTERM');
        }
      },
      keepOnFailure: platformEnvironment.keepOnFailure,
      reportFailure: async () => await collectFailureDiagnostics(env, diagnosticsPath),
    });
    await executionPromise;
  } finally {
    unregisterSignals();
  }
}

async function cleanShard(shardName) {
  const env = buildPlatformK3dShardEnvironment(shardName);
  await runCommandAsync(process.execPath, [lifecycleScript, 'down'], repositoryRoot, env);
}

async function buildCliArtifact(env, signal) {
  if (env.COMPARTMENT_E2E_SKIP_CLI_BUILD !== '1') {
    await runInterruptibleCommand('pnpm', ['cli:build:sea', '--distribution-channel', 'source'], env, signal);
  }
}

async function startPlatform(env, signal) {
  const archiveDirectory = env.COMPARTMENT_E2E_IMAGE_ARCHIVE_DIR;
  const args =
    archiveDirectory === undefined
      ? [lifecycleScript, 'up']
      : [lifecycleScript, 'up', '--image-source', 'archive', '--image-archive-dir', archiveDirectory];
  await runInterruptibleCommand(process.execPath, args, env, signal);
}

function startNetworkPolicySampler(env, diagnosticsPath) {
  return spawn(process.execPath, [networkPolicySamplerScript, join(diagnosticsPath, 'network-policy-series.log')], {
    cwd: repositoryRoot,
    env,
    stdio: 'ignore',
  });
}

async function collectFailureDiagnostics(env, diagnosticsPath) {
  try {
    await runCommandAsync(process.execPath, [diagnosticsScript, diagnosticsPath], repositoryRoot, env);
  } catch (diagnosticsError) {
    process.stderr.write(`Diagnostics also failed: ${String(diagnosticsError)}\n`);
  }
}

async function runShardSuites(suites, env, ownerEnvironmentPath, signal) {
  for (const suite of suites) {
    if (suite === 'managed-install') {
      await runCliE2eSuite(env, 'test/platform-k3d-managed-install.e2e.test.ts', signal);
    } else if (suite === 'public-operator-install') {
      await runCliE2eSuite(env, 'test/platform-k3d-public-operator-install.e2e.test.ts', signal);
    } else if (suite === 'retained-state') {
      await runInterruptibleCommand(process.execPath, [retainedStateGateScript], env, signal);
    } else if (suite === 'install') {
      await runCliE2eSuite(env, 'test/platform-k3d-install.e2e.test.ts', signal);
      Object.assign(env, readOwnerEnvironment(ownerEnvironmentPath));
      await runInterruptibleCommand(process.execPath, [lifecycleScript, 'configure'], env, signal);
    } else if (suite === 'system-user') {
      await runCliE2eSuite(env, 'test/system-user-flow.e2e.test.ts', signal);
    } else if (suite === 'system-update') {
      await runCliE2eSuite(env, 'test/platform-k3d-system-update.e2e.test.ts', signal);
    } else if (suite === 'ha') {
      await runCliE2eSuite(env, 'test/platform-k3d-ha.e2e.test.ts', signal);
    } else if (suite === 'network-policy') {
      await runInterruptibleCommand(
        'bash',
        [networkPolicyGateScript, env.COMPARTMENT_E2E_KUBE_CONTEXT, '10.42.0.0/16', '10.43.0.0/16'],
        env,
        signal,
      );
    } else if (suite === 'console') {
      await runInterruptibleCommand('pnpm', ['--filter', '@compartment/console', 'test:e2e:install'], env, signal);
      await runCliE2eSuite(env, 'test/console.e2e.test.ts', signal);
    } else if (suite === 'build-matrix') {
      await runBuildMatrixPartition(env, signal);
    } else if (suite === 'g1') {
      await runCliE2eSuite(env, 'test/platform-k3d-g1.e2e.test.ts', signal);
    } else if (suite === 'product-log') {
      await runInterruptibleCommand(process.execPath, [productLogGateScript], env, signal);
    } else {
      throw new Error(`Unknown platform k3d e2e suite: ${suite}`);
    }
  }
}

export async function prepareSystemUpdateBaseline(env, signal) {
  const valuesPath = join(repositoryRoot, env.COMPARTMENT_E2E_PLATFORM_VALUES_PATH);
  const updateValuesPath = join(repositoryRoot, env.COMPARTMENT_E2E_UPDATE_VALUES_PATH);
  const values = parse(readFileSync(valuesPath, 'utf8'));
  if (values?.images === undefined || typeof values.images !== 'object') {
    throw new Error(`Expected platform image values in ${valuesPath}.`);
  }
  mkdirSync(dirname(updateValuesPath), { recursive: true });
  writeFileSync(updateValuesPath, stringify(values), { mode: 0o600 });
  const buildDirectory = join(dirname(valuesPath), 'baseline-image');
  mkdirSync(buildDirectory, { recursive: true });
  const dockerfilePath = join(buildDirectory, 'Dockerfile');
  writeFileSync(dockerfilePath, 'ARG BASE_IMAGE\nFROM ${BASE_IMAGE}\n', { mode: 0o600 });
  try {
    for (const [imageName, image] of Object.entries(values.images)) {
      if (
        image === null ||
        typeof image !== 'object' ||
        typeof image.repository !== 'string' ||
        typeof image.digest !== 'string'
      ) {
        throw new Error(`Expected a repository and digest for images.${imageName}.`);
      }
      const localRepository = resolveLocalBaselineRepository(image.repository, env.COMPARTMENT_E2E_REGISTRY_PORT);
      const baselineRef = `${localRepository}:e2e-initial`;
      await runInterruptibleCommand(
        'docker',
        [
          'build',
          '--build-arg',
          `BASE_IMAGE=${localRepository}@${image.digest}`,
          '--label',
          `dev.compartment.e2e.baseline=${imageName}`,
          '--tag',
          baselineRef,
          buildDirectory,
        ],
        env,
        signal,
      );
      await runInterruptibleCommand('docker', ['push', baselineRef], env, signal);
      image.tag = 'e2e-initial';
      image.digest = readPushedImageDigest(baselineRef, env);
    }
    writeFileSync(valuesPath, stringify(values), { mode: 0o600 });
  } finally {
    rmSync(buildDirectory, { force: true, recursive: true });
  }
}

function resolveLocalBaselineRepository(repository, registryPort) {
  if (!/^k3d-[^/]+\/.+/u.test(repository)) {
    throw new Error(`Expected baseline image repository ${repository} to use the k3d-<registry>/<repository> format.`);
  }
  return repository.replace(/^k3d-[^/]+/u, `localhost:${registryPort}`);
}

function readPushedImageDigest(imageRef, env) {
  const repoDigests = JSON.parse(
    captureCommand('docker', ['image', 'inspect', '--format={{json .RepoDigests}}', imageRef], repositoryRoot, env),
  );
  const digestRef = repoDigests.find((candidate) =>
    candidate.startsWith(`${imageRef.slice(0, imageRef.lastIndexOf(':'))}@`),
  );
  const digest = digestRef?.slice(digestRef.lastIndexOf('@') + 1);
  if (digest === undefined || !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new Error(`Expected a pushed baseline digest for ${imageRef}.`);
  }
  return digest;
}

async function runBuildMatrixPartition(env, signal) {
  if (env.COMPARTMENT_E2E_BUILD_MATRIX_PARTITION === undefined) {
    throw new Error('Build matrix shards must define COMPARTMENT_E2E_BUILD_MATRIX_PARTITION.');
  }
  await runCliE2eSuite(env, 'test/system-build-matrix.e2e.test.ts', signal);
}

async function runCliE2eSuite(env, include, signal) {
  await runInterruptibleCommand(
    'pnpm',
    ['--filter', '@compartment/cli', 'test:e2e'],
    {
      ...env,
      COMPARTMENT_DEPLOY_E2E_INCLUDE: include,
    },
    signal,
  );
}

async function runInterruptibleCommand(file, args, env, signal) {
  await runCommandAsync(file, args, repositoryRoot, env, { signal, terminateProcessGroup: true });
}

function readOwnerEnvironment(path) {
  const entries = readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split('='));
  if (
    entries.length !== 2 ||
    entries.some(([name, value, ...extra]) => name === '' || value === '' || extra.length > 0)
  ) {
    throw new Error(`Invalid platform owner environment at ${path}.`);
  }
  return Object.fromEntries(entries);
}

runMain(import.meta.url, process.argv[1], async () => {
  const shardName = readPlatformK3dShard(process.argv.slice(2));
  if (process.env.COMPARTMENT_E2E_CLEANUP_ONLY === '1') {
    await cleanShard(shardName);
  } else {
    await runShard(shardName);
  }
});
