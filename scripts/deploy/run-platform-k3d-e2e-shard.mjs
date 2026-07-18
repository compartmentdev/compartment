import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { runCommand, runCommandAsync } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';
import { readPlatformK3dEnvironment } from './platform-k3d-e2e.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const lifecycleScript = join(repositoryRoot, 'scripts/deploy/platform-k3d-e2e.mjs');
const diagnosticsScript = join(repositoryRoot, 'scripts/deploy/collect-platform-k3d-e2e-diagnostics.mjs');
const productLogGateScript = join(repositoryRoot, 'scripts/deploy/run-platform-k3d-product-log-gate.mjs');
const retainedStateGateScript = join(repositoryRoot, 'scripts/deploy/run-platform-k3d-retained-state-gate.mjs');
const shardDefinitions = Object.freeze({
  'build-gates': Object.freeze({ index: 2, suites: Object.freeze(['install', 'build-matrix', 'g1', 'product-log']) }),
  'managed-install': Object.freeze({ index: 0, suites: Object.freeze(['managed-install', 'retained-state']) }),
  'user-flow': Object.freeze({ index: 1, suites: Object.freeze(['install', 'system-user', 'console']) }),
});

export function readPlatformK3dShard(args) {
  const [shardName, ...extraArgs] = args;
  if (shardName === undefined || extraArgs.length > 0 || !(shardName in shardDefinitions)) {
    throw new Error(
      `Usage: node ./scripts/deploy/run-platform-k3d-e2e-shard.mjs <${Object.keys(shardDefinitions).join('|')}>`,
    );
  }
  return shardName;
}

export function readPlatformK3dShardSuites(shardName) {
  const definition = shardDefinitions[shardName];
  if (definition === undefined) {
    throw new Error(`Unknown platform k3d e2e shard: ${shardName}`);
  }
  return definition.suites;
}

export function isPlatformK3dSuite(suite) {
  return [
    'managed-install',
    'retained-state',
    'install',
    'system-user',
    'console',
    'build-matrix',
    'g1',
    'product-log',
  ].includes(suite);
}

export function buildPlatformK3dShardEnvironment(shardName, baseEnv = process.env) {
  const definition = shardDefinitions[shardName];
  if (definition === undefined) {
    throw new Error(`Unknown platform k3d e2e shard: ${shardName}`);
  }
  const portOffset = definition.index * 100;
  const clusterName = baseEnv.COMPARTMENT_E2E_CLUSTER_NAME ?? `compartment-e2e-${shardName}`;
  const httpPort = baseEnv.COMPARTMENT_E2E_HTTP_PORT ?? (18_080 + portOffset).toString();
  const stateDirectory = `.compartment/platform-k3d-${shardName}`;
  const environment = {
    ...baseEnv,
    COMPARTMENT_E2E_API_URL: `http://console.compartment.localhost:${httpPort}`,
    COMPARTMENT_E2E_CLUSTER_NAME: clusterName,
    COMPARTMENT_E2E_COMPARTMENT_URL: `http://console.compartment.localhost:${httpPort}`,
    COMPARTMENT_E2E_DIAGNOSTICS_PATH: `.compartment/platform-k3d-diagnostics-${shardName}`,
    COMPARTMENT_E2E_HTTP_PORT: httpPort,
    COMPARTMENT_E2E_HTTPS_PORT: baseEnv.COMPARTMENT_E2E_HTTPS_PORT ?? (18_443 + portOffset).toString(),
    COMPARTMENT_E2E_KUBE_CONTEXT: `k3d-${clusterName}`,
    COMPARTMENT_E2E_MANAGED_ACME_PORT: baseEnv.COMPARTMENT_E2E_MANAGED_ACME_PORT ?? (19_500 + portOffset).toString(),
    COMPARTMENT_E2E_MANAGED_BROKER_PORT: (19_000 + portOffset).toString(),
    COMPARTMENT_E2E_MANAGED_NAMESPACE: baseEnv.COMPARTMENT_E2E_MANAGED_NAMESPACE ?? `compartment-managed-${shardName}`,
    COMPARTMENT_E2E_MANAGED_VALUES_PATH: `${stateDirectory}/managed-values.yaml`,
    COMPARTMENT_E2E_OWNER_ENV_PATH: `${stateDirectory}/owner.env`,
    COMPARTMENT_E2E_PEBBLE_CA_PATH: `${stateDirectory}/pebble.minica.pem`,
    COMPARTMENT_E2E_PEBBLE_ROOT_PATH: `${stateDirectory}/pebble.root.pem`,
    COMPARTMENT_E2E_PLATFORM_MODE: 'k3d',
    COMPARTMENT_E2E_PLATFORM_NAMESPACE: baseEnv.COMPARTMENT_E2E_PLATFORM_NAMESPACE ?? `compartment-${shardName}`,
    COMPARTMENT_E2E_PLATFORM_VALUES_PATH: `${stateDirectory}/platform-values.yaml`,
    COMPARTMENT_E2E_REGISTRY_NAME: baseEnv.COMPARTMENT_E2E_REGISTRY_NAME ?? `${clusterName}-registry`,
    COMPARTMENT_E2E_REGISTRY_PORT: baseEnv.COMPARTMENT_E2E_REGISTRY_PORT ?? (15_500 + portOffset).toString(),
    COMPARTMENT_E2E_SHARD: shardName,
    COMPARTMENT_SELF_HOSTED_USER_SETUP_E2E: '1',
  };
  readPlatformK3dEnvironment(environment);
  return environment;
}

export function registerPlatformK3dSignalCleanup(cleanup, keepOnFailure) {
  let cleanupPromise;
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      cleanupPromise ??= keepOnFailure ? Promise.resolve() : cleanup();
      cleanupPromise
        .catch((error) => process.stderr.write(`Signal cleanup failed: ${String(error)}\n`))
        .finally(() => {
          unregister();
          process.kill(process.pid, signal);
        });
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }

  function unregister() {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
  }

  return unregister;
}

export async function runWithPlatformK3dCleanup({ cleanup, execute, keepOnFailure, reportFailure }) {
  let executionError;
  let cleanupError;
  try {
    await execute();
  } catch (error) {
    executionError = error;
    try {
      await reportFailure();
    } catch (reportError) {
      process.stderr.write(`Failure reporting also failed: ${String(reportError)}\n`);
    }
  } finally {
    if (executionError === undefined || !keepOnFailure) {
      try {
        await cleanup();
      } catch (error) {
        cleanupError = error;
        if (executionError !== undefined) {
          process.stderr.write(`Cleanup also failed: ${String(error)}\n`);
        }
      }
    } else {
      process.stderr.write('Keeping failed k3d shard because COMPARTMENT_E2E_KEEP_ON_FAILURE=1.\n');
    }
  }
  if (executionError !== undefined) {
    throw executionError;
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }
}

async function runShard(shardName) {
  const env = buildPlatformK3dShardEnvironment(shardName);
  const platformEnvironment = readPlatformK3dEnvironment(env);
  const definition = shardDefinitions[shardName];
  const diagnosticsPath = join(repositoryRoot, env.COMPARTMENT_E2E_DIAGNOSTICS_PATH);
  rmSync(diagnosticsPath, { force: true, recursive: true });
  let cleanupPromise;
  const cleanup = async () => {
    cleanupPromise ??= runCommandAsync(process.execPath, [lifecycleScript, 'down'], repositoryRoot, env);
    await cleanupPromise;
  };
  const unregisterSignals = registerPlatformK3dSignalCleanup(cleanup, platformEnvironment.keepOnFailure);
  try {
    await runWithPlatformK3dCleanup({
      cleanup,
      execute: async () => {
        buildCliArtifact(env);
        await startPlatform(env);
        await runShardSuites(definition.suites, env, platformEnvironment.platformOwnerEnvironmentPath);
      },
      keepOnFailure: platformEnvironment.keepOnFailure,
      reportFailure: async () => await collectFailureDiagnostics(env, diagnosticsPath),
    });
  } finally {
    unregisterSignals();
  }
}

async function cleanShard(shardName) {
  const env = buildPlatformK3dShardEnvironment(shardName);
  await runCommandAsync(process.execPath, [lifecycleScript, 'down'], repositoryRoot, env);
}

function buildCliArtifact(env) {
  if (env.COMPARTMENT_E2E_SKIP_CLI_BUILD !== '1') {
    runCommand('pnpm', ['cli:build:sea', '--distribution-channel', 'source'], repositoryRoot, env);
  }
}

async function startPlatform(env) {
  const archiveDirectory = env.COMPARTMENT_E2E_IMAGE_ARCHIVE_DIR;
  const args =
    archiveDirectory === undefined
      ? [lifecycleScript, 'up']
      : [lifecycleScript, 'up', '--image-source', 'archive', '--image-archive-dir', archiveDirectory];
  await runCommandAsync(process.execPath, args, repositoryRoot, env);
}

async function collectFailureDiagnostics(env, diagnosticsPath) {
  try {
    await runCommandAsync(process.execPath, [diagnosticsScript, diagnosticsPath], repositoryRoot, env);
  } catch (diagnosticsError) {
    process.stderr.write(`Diagnostics also failed: ${String(diagnosticsError)}\n`);
  }
}

async function runShardSuites(suites, env, ownerEnvironmentPath) {
  for (const suite of suites) {
    if (!isPlatformK3dSuite(suite)) {
      throw new Error(`Unknown platform k3d e2e suite: ${suite}`);
    }
    if (suite === 'managed-install') {
      runCliE2eSuite(env, 'test/platform-k3d-managed-install.e2e.test.ts');
    } else if (suite === 'retained-state') {
      runCommand(process.execPath, [retainedStateGateScript], repositoryRoot, env);
    } else if (suite === 'install') {
      runCliE2eSuite(env, 'test/platform-k3d-install.e2e.test.ts');
      Object.assign(env, readOwnerEnvironment(ownerEnvironmentPath));
      await runCommandAsync(process.execPath, [lifecycleScript, 'configure'], repositoryRoot, env);
    } else if (suite === 'system-user') {
      runCliE2eSuite(env, 'test/system-user-flow.e2e.test.ts');
    } else if (suite === 'console') {
      runCommand('pnpm', ['--filter', '@compartment/console', 'test:e2e:install'], repositoryRoot, env);
      runCliE2eSuite(env, 'test/console.e2e.test.ts');
    } else if (suite === 'build-matrix') {
      runCliE2eSuite(env, 'test/system-build-matrix.e2e.test.ts');
    } else if (suite === 'g1') {
      runCliE2eSuite(env, 'test/platform-k3d-g1.e2e.test.ts');
    } else if (suite === 'product-log') {
      runCommand(process.execPath, [productLogGateScript], repositoryRoot, env);
    } else {
      throw new Error(`Unknown platform k3d e2e suite: ${suite}`);
    }
  }
}

function runCliE2eSuite(env, include) {
  runCommand('pnpm', ['--filter', '@compartment/cli', 'test:e2e'], repositoryRoot, {
    ...env,
    COMPARTMENT_DEPLOY_E2E_INCLUDE: include,
  });
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
