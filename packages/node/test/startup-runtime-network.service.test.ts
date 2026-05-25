import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { NodeConfig } from '../src/config';
import { reconcileRuntimeNetworksOnStartup } from '../src/services/startup-runtime-network.service';
import type { RuntimeDeployConfig } from '../src/services/runtime.types';

type ReconcileRuntimeNetworks = (config: RuntimeDeployConfig) => Promise<void>;
type WaitForRetry = (delayMs: number) => Promise<void>;

interface StartupRuntimeNetworkLogger {
  warn(payload: StartupRuntimeNetworkLogPayload, message: string): void;
}

interface StartupRuntimeNetworkLogPayload {
  attempt: number;
  maxAttempts: number;
}

const mocks: {
  reconcileRuntimeNetworks: Mock<ReconcileRuntimeNetworks>;
} = vi.hoisted((): { reconcileRuntimeNetworks: Mock<ReconcileRuntimeNetworks> } => ({
  reconcileRuntimeNetworks: vi.fn<ReconcileRuntimeNetworks>(),
}));

vi.mock(
  '../src/services/runtime-network.service',
  (): { reconcileRuntimeNetworks: Mock<ReconcileRuntimeNetworks> } => ({
    reconcileRuntimeNetworks: mocks.reconcileRuntimeNetworks,
  }),
);

afterEach((): void => {
  mocks.reconcileRuntimeNetworks.mockReset();
});

describe('reconcileRuntimeNetworksOnStartup', (): void => {
  it('does not block node startup when caddy never becomes ready', async (): Promise<void> => {
    const warnings: string[] = [];
    const logger: StartupRuntimeNetworkLogger = createStartupRuntimeNetworkLogger(warnings);
    const waitForRetry: WaitForRetry = async (): Promise<void> => {
      await Promise.resolve();
    };
    mocks.reconcileRuntimeNetworks.mockRejectedValue(new Error('Expected one running caddy container.'));

    await expect(reconcileRuntimeNetworksOnStartup(createNodeConfig(), logger, waitForRetry)).resolves.toBeUndefined();

    expect(mocks.reconcileRuntimeNetworks).toHaveBeenCalledTimes(20);
    expect(warnings).toContain(
      'Runtime network actors did not become ready during node startup. Runtime operations will reconcile networks on demand.',
    );
  });

  it('still fails startup for non-runtime-actor errors', async (): Promise<void> => {
    const warnings: string[] = [];
    const logger: StartupRuntimeNetworkLogger = createStartupRuntimeNetworkLogger(warnings);
    const waitForRetry: WaitForRetry = async (): Promise<void> => {
      await Promise.resolve();
    };
    mocks.reconcileRuntimeNetworks.mockRejectedValue(new Error('Docker daemon is unavailable.'));

    await expect(reconcileRuntimeNetworksOnStartup(createNodeConfig(), logger, waitForRetry)).rejects.toThrow(
      'Docker daemon is unavailable.',
    );
    expect(warnings).toHaveLength(0);
  });
});

function createStartupRuntimeNetworkLogger(warnings: string[]): StartupRuntimeNetworkLogger {
  return new TestStartupRuntimeNetworkLogger(warnings);
}

class TestStartupRuntimeNetworkLogger implements StartupRuntimeNetworkLogger {
  readonly #warnings: string[];

  constructor(warnings: string[]) {
    this.#warnings = warnings;
  }

  warn(_payload: StartupRuntimeNetworkLogPayload, message: string): void {
    this.#warnings.push(message);
  }
}

function createNodeConfig(): NodeConfig {
  return {
    apiUrl: 'http://127.0.0.1:9443',
    appPortEnd: 31999,
    appPortStart: 31000,
    dockerNamespace: 'compartment-test',
    logLevel: 'info',
    name: 'local-node',
    nodeSocketPath: '/tmp/compartment/node-test/node/agent.sock',
    runtimeConnectivityMode: 'network',
    runtimeDefaultUpstreamHost: '127.0.0.1',
    runtimeRegistryCredentials: {
      password: 'registry-read-password',
      serverAddress: '127.0.0.1:39461',
      username: 'registry-reader',
    },
    runtimeProbeImageRef: 'ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
    version: '0.1.0',
    runtimeControlToken: 'test-runtime-control-token',
  };
}
