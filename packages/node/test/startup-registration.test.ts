import type { NodeRegistrationResponse } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { NodeConfig } from '../src/config';
import { createRegisterNode } from '../src/services/registration-api.service';
import type { RegisterNode } from '../src/services/registration-api.types';
import { registerNodeOnStartup } from '../src/services/startup-registration.service';
import { createRuntimeNetworkPoolConfig } from './runtime-network-pool.fixture';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface StartupRegistrationLogger {
  warn(payload: StartupRegistrationLogPayload, message: string): void;
}

interface StartupRegistrationLogPayload {
  attempt: number;
  maxAttempts: number;
}

type WaitForRetry = (delayMs: number) => Promise<void>;

describe('registerNodeOnStartup', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('retries when the API is not ready yet', async (): Promise<void> => {
    const config: NodeConfig = createNodeConfig();
    const response: NodeRegistrationResponse = createRegistrationResponse();
    let waitCalls: number = 0;
    let warnCalls: number = 0;
    let registrationAttempts: number = 0;

    const logger: StartupRegistrationLogger = createStartupRegistrationLogger((): void => {
      warnCalls += 1;
    });
    const waitForRetry: WaitForRetry = async (): Promise<void> => {
      await Promise.resolve();
      waitCalls += 1;
    };
    const registerNode: RegisterNode = async (): Promise<NodeRegistrationResponse> => {
      await Promise.resolve();
      registrationAttempts += 1;

      if (registrationAttempts < 3) {
        throw createConnectionRefusedError();
      }

      return response;
    };

    const result: NodeRegistrationResponse = await registerNodeOnStartup(registerNode, config, logger, waitForRetry);

    expect(result.node.id).toBe('node_123');
    expect(registrationAttempts).toBe(3);
    expect(waitCalls).toBe(2);
    expect(warnCalls).toBe(2);
  });

  it('does not retry non-network registration errors', async (): Promise<void> => {
    const config: NodeConfig = createNodeConfig();
    let waitCalls: number = 0;
    let warnCalls: number = 0;

    const logger: StartupRegistrationLogger = createStartupRegistrationLogger((): void => {
      warnCalls += 1;
    });
    const waitForRetry: WaitForRetry = async (): Promise<void> => {
      await Promise.resolve();
      waitCalls += 1;
    };
    const registerNode: RegisterNode = async (): Promise<NodeRegistrationResponse> => {
      await Promise.resolve();
      throw new Error('registration failed');
    };

    await expect(registerNodeOnStartup(registerNode, config, logger, waitForRetry)).rejects.toThrow(
      'registration failed',
    );
    expect(waitCalls).toBe(0);
    expect(warnCalls).toBe(0);
  });

  it('keeps retrying when createRegisterNode hits connection refused before the API is ready', async (): Promise<void> => {
    const config: NodeConfig = createNodeConfig();
    let waitCalls: number = 0;
    let warnCalls: number = 0;
    let fetchCalls: number = 0;
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (): Promise<Response> => {
        await Promise.resolve();
        fetchCalls += 1;

        if (fetchCalls < 3) {
          throw createConnectionRefusedError();
        }

        return new Response(JSON.stringify(createRegistrationResponse()), {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        });
      });
    const logger: StartupRegistrationLogger = createStartupRegistrationLogger((): void => {
      warnCalls += 1;
    });
    const waitForRetry: WaitForRetry = async (): Promise<void> => {
      await Promise.resolve();
      waitCalls += 1;
    };
    const registerNode: RegisterNode = createRegisterNode({
      apiUrl: config.apiUrl,
      runtimeControlToken: config.runtimeControlToken,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result: NodeRegistrationResponse = await registerNodeOnStartup(registerNode, config, logger, waitForRetry);

    expect(result.node.id).toBe('node_123');
    expect(fetchCalls).toBe(3);
    expect(waitCalls).toBe(2);
    expect(warnCalls).toBe(2);
  });
});

function createStartupRegistrationLogger(onWarn: () => void): StartupRegistrationLogger {
  return new TestStartupRegistrationLogger(onWarn);
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
    resourceBackupDirectory: '/var/lib/compartment/resource-backups',
    runtimeConnectivityMode: 'loopback',
    runtimeDefaultUpstreamHost: '127.0.0.1',
    runtimeNetworkPool: createRuntimeNetworkPoolConfig(),
    runtimeGid: 10001,
    runtimeUid: 10001,
    runtimeRegistryCredentials: {
      password: 'registry-read-password',
      serverAddress: '127.0.0.1:39461',
      username: 'registry-reader',
    },
    runtimeProbeImageRef: 'ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
    runtimeSocketGid: 10001,
    version: '0.1.0',
    runtimeControlToken: 'test-runtime-control-token',
  };
}

function createRegistrationResponse(): NodeRegistrationResponse {
  return {
    node: {
      id: 'node_123',
      name: 'local-node',
      nodeSocketPath: '/tmp/compartment/node-test/node/agent.sock',
      nodeVersion: '0.1.0',
    },
    registeredAt: '2026-03-21T14:00:00.000Z',
  };
}

class TestStartupRegistrationLogger implements StartupRegistrationLogger {
  readonly #onWarn: () => void;

  constructor(onWarn: () => void) {
    this.#onWarn = onWarn;
  }

  warn(payload: StartupRegistrationLogPayload, message: string): void {
    void payload;
    void message;
    this.#onWarn();
  }
}

function createConnectionRefusedError(): TypeError {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9443'), {
      code: 'ECONNREFUSED',
    }),
  });
}
