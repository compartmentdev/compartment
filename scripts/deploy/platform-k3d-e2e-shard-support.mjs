import { fileURLToPath } from 'node:url';

import { readPlatformK3dEnvironment } from './platform-k3d-e2e.mjs';
import { platformK3dShardDefinitions, platformK3dShardNames } from './platform-k3d-e2e-shards.mjs';

const e2eFixtureBinPath = fileURLToPath(new URL('./fixtures/kubectl-e2e-bin/', import.meta.url));

export function readPlatformK3dShard(args) {
  const [shardName, ...extraArgs] = args;
  if (shardName === undefined || extraArgs.length > 0 || !platformK3dShardNames.includes(shardName)) {
    throw new Error(`Usage: node ./scripts/deploy/run-platform-k3d-e2e-shard.mjs <${platformK3dShardNames.join('|')}>`);
  }
  return shardName;
}

export function readPlatformK3dShardSuites(shardName) {
  const definition = readShardDefinition(shardName);
  if (definition === undefined) {
    throw new Error(`Unknown platform k3d e2e shard: ${shardName}`);
  }
  return definition.suites;
}

export function buildPlatformK3dShardEnvironment(shardName, baseEnv = process.env) {
  const definition = readShardDefinition(shardName);
  if (definition === undefined) {
    throw new Error(`Unknown platform k3d e2e shard: ${shardName}`);
  }
  const portOffset = definition.index * 100;
  const clusterName = baseEnv.COMPARTMENT_E2E_CLUSTER_NAME ?? definition.clusterName ?? `compartment-e2e-${shardName}`;
  const httpPort = baseEnv.COMPARTMENT_E2E_HTTP_PORT ?? (18_080 + portOffset).toString();
  const stateDirectory = `.compartment/platform-k3d-${shardName}`;
  const environment = {
    ...baseEnv,
    COMPARTMENT_E2E_API_URL: `http://console.compartment.localhost:${httpPort}`,
    COMPARTMENT_E2E_CLUSTER_NAME: clusterName,
    COMPARTMENT_E2E_COMPARTMENT_URL: `http://console.compartment.localhost:${httpPort}`,
    COMPARTMENT_E2E_DIAGNOSTICS_PATH: `.compartment/platform-k3d-diagnostics-${shardName}`,
    COMPARTMENT_E2E_GVISOR_AVAILABLE: definition.gvisorEnabled ? '1' : '0',
    COMPARTMENT_E2E_GVISOR_ENABLED: definition.gvisorEnabled ? '1' : '0',
    COMPARTMENT_E2E_HIGH_AVAILABILITY: definition.highAvailability ? '1' : '0',
    COMPARTMENT_E2E_HTTP_PORT: httpPort,
    COMPARTMENT_E2E_HTTPS_PORT: baseEnv.COMPARTMENT_E2E_HTTPS_PORT ?? (18_443 + portOffset).toString(),
    COMPARTMENT_E2E_INGRESS_CLASS: definition.ingressClass,
    COMPARTMENT_E2E_KUBE_CONTEXT: `k3d-${clusterName}`,
    COMPARTMENT_E2E_MANAGED_NAMESPACE: baseEnv.COMPARTMENT_E2E_MANAGED_NAMESPACE ?? `compartment-managed-${shardName}`,
    COMPARTMENT_E2E_MANAGED_VALUES_PATH: `${stateDirectory}/managed-values.yaml`,
    COMPARTMENT_E2E_OWNER_ENV_PATH: `${stateDirectory}/owner.env`,
    COMPARTMENT_E2E_PEBBLE_CA_PATH: `${stateDirectory}/pebble.minica.pem`,
    COMPARTMENT_E2E_PEBBLE_ROOT_PATH: `${stateDirectory}/pebble.root.pem`,
    COMPARTMENT_E2E_PUBLIC_OPERATOR_VALUES_PATH: `${stateDirectory}/public-operator-values.yaml`,
    COMPARTMENT_E2E_PLATFORM_MODE: 'k3d',
    COMPARTMENT_E2E_PLATFORM_NAMESPACE: baseEnv.COMPARTMENT_E2E_PLATFORM_NAMESPACE ?? `compartment-${shardName}`,
    COMPARTMENT_E2E_PLATFORM_VALUES_PATH: `${stateDirectory}/platform-values.yaml`,
    COMPARTMENT_E2E_UPDATE_VALUES_PATH: `${stateDirectory}/update-values.yaml`,
    COMPARTMENT_E2E_PREVIOUS_PLATFORM_VALUES_PATH: `${stateDirectory}/previous-platform-values.yaml`,
    COMPARTMENT_E2E_REGISTRY_NAME: baseEnv.COMPARTMENT_E2E_REGISTRY_NAME ?? `${clusterName}-registry`,
    COMPARTMENT_E2E_REGISTRY_PORT: baseEnv.COMPARTMENT_E2E_REGISTRY_PORT ?? (15_500 + portOffset).toString(),
    COMPARTMENT_E2E_SHARD: shardName,
    COMPARTMENT_CLI_BUNDLED_COSIGN_PATH: 'scripts/deploy/fixtures/cosign-k3d-e2e.mjs',
    COMPARTMENT_SELF_HOSTED_USER_SETUP_E2E: '1',
    PATH: `${e2eFixtureBinPath}:${baseEnv.PATH ?? ''}`,
  };
  delete environment.COMPARTMENT_E2E_BUILD_MATRIX_PARTITION;
  if (definition.buildMatrixPartition !== undefined) {
    environment.COMPARTMENT_E2E_BUILD_MATRIX_PARTITION = definition.buildMatrixPartition;
  }
  readPlatformK3dEnvironment(environment);
  return environment;
}

function readShardDefinition(shardName) {
  return Object.hasOwn(platformK3dShardDefinitions, shardName) ? platformK3dShardDefinitions[shardName] : undefined;
}

export function registerPlatformK3dSignalCleanup(cancelExecution, waitForExecution) {
  let signalPromise;
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      signalPromise ??= (async () => {
        cancelExecution();
        try {
          await waitForExecution();
        } catch {
          // The interrupted execution reports its own failure before cleanup.
        } finally {
          unregister();
          process.kill(process.pid, signal);
        }
      })();
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
  let failureReported = false;
  const reportFailureOnce = async () => {
    if (failureReported) {
      return;
    }
    failureReported = true;
    try {
      await reportFailure();
    } catch (reportError) {
      process.stderr.write(`Failure reporting also failed: ${String(reportError)}\n`);
    }
  };
  try {
    await execute();
  } catch (error) {
    executionError = error;
    await reportFailureOnce();
  } finally {
    if (executionError === undefined || !keepOnFailure) {
      try {
        await cleanup();
      } catch (error) {
        cleanupError = error;
        await reportFailureOnce();
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
