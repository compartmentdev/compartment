import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { runCommandAsync } from '../lib/command.mjs';
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
const productLogGateScript = join(repositoryRoot, 'scripts/deploy/run-platform-k3d-product-log-gate.mjs');
const retainedStateGateScript = join(repositoryRoot, 'scripts/deploy/run-platform-k3d-retained-state-gate.mjs');
async function runShard(shardName) {
  const env = buildPlatformK3dShardEnvironment(shardName);
  const platformEnvironment = readPlatformK3dEnvironment(env);
  const suites = readPlatformK3dShardSuites(shardName);
  const diagnosticsPath = join(repositoryRoot, env.COMPARTMENT_E2E_DIAGNOSTICS_PATH);
  rmSync(diagnosticsPath, { force: true, recursive: true });
  let cleanupPromise;
  const cleanup = async () => {
    cleanupPromise ??= runCommandAsync(process.execPath, [lifecycleScript, 'down'], repositoryRoot, env);
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
        await runShardSuites(
          suites,
          env,
          platformEnvironment.platformOwnerEnvironmentPath,
          commandAbortController.signal,
        );
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
    } else if (suite === 'retained-state') {
      await runInterruptibleCommand(process.execPath, [retainedStateGateScript], env, signal);
    } else if (suite === 'install') {
      await runCliE2eSuite(env, 'test/platform-k3d-install.e2e.test.ts', signal);
      Object.assign(env, readOwnerEnvironment(ownerEnvironmentPath));
      await runInterruptibleCommand(process.execPath, [lifecycleScript, 'configure'], env, signal);
    } else if (suite === 'system-user') {
      await runCliE2eSuite(env, 'test/system-user-flow.e2e.test.ts', signal);
    } else if (suite === 'console') {
      await runInterruptibleCommand('pnpm', ['--filter', '@compartment/console', 'test:e2e:install'], env, signal);
      await runCliE2eSuite(env, 'test/console.e2e.test.ts', signal);
    } else if (suite === 'build-matrix') {
      await runCliE2eSuite(env, 'test/system-build-matrix.e2e.test.ts', signal);
    } else if (suite === 'g1') {
      await runCliE2eSuite(env, 'test/platform-k3d-g1.e2e.test.ts', signal);
    } else if (suite === 'product-log') {
      await runInterruptibleCommand(process.execPath, [productLogGateScript], env, signal);
    } else {
      throw new Error(`Unknown platform k3d e2e suite: ${suite}`);
    }
  }
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
