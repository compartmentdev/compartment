import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DomainHostPlan } from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { DockerExecutionContext, RestartSelfHostedRuntimeInput } from '../src/docker-runtime.types';
import type * as NodeAgentRuntimeNetworkSourceModule from '../src/node-agent-runtime-network';
import type * as NodeAgentServiceSourceModule from '../src/node-agent-service';
import type * as SelfHostedInstallPathsSourceModule from '../src/self-hosted-install-paths';
import { generatedSelfHosted24ByteSecret, generatedSelfHostedVariablesMasterKey } from './update.test.harness';

type EnsureSelfHostedDockerExecutionContext = () => Promise<DockerExecutionContext>;
type ReconcileNodeAgentRuntimeNetworks = (input: object) => Promise<void>;
type RestartNodeAgentHostService = (input: RestartNodeAgentHostServiceInput) => Promise<void>;
type RestartSelfHostedRuntime = (
  context: DockerExecutionContext,
  input: RestartSelfHostedRuntimeInput,
) => Promise<void>;

interface RestartNodeAgentHostServiceInput {
  envPath: string;
  waitForHealth?: boolean | undefined;
}

interface DomainRuntimeMocks {
  ensureSelfHostedDockerExecutionContext: Mock<EnsureSelfHostedDockerExecutionContext>;
  reconcileNodeAgentRuntimeNetworks: Mock<ReconcileNodeAgentRuntimeNetworks>;
  restartNodeAgentHostService: Mock<RestartNodeAgentHostService>;
  restartSelfHostedRuntime: Mock<RestartSelfHostedRuntime>;
}

interface TemporaryInstallPaths {
  configDir: string;
  dataDir: string;
}

const mocks: DomainRuntimeMocks = vi.hoisted(
  (): DomainRuntimeMocks => ({
    ensureSelfHostedDockerExecutionContext: vi.fn<EnsureSelfHostedDockerExecutionContext>(),
    reconcileNodeAgentRuntimeNetworks: vi.fn<ReconcileNodeAgentRuntimeNetworks>(),
    restartNodeAgentHostService: vi.fn<RestartNodeAgentHostService>(),
    restartSelfHostedRuntime: vi.fn<RestartSelfHostedRuntime>(),
  }),
);

describe.sequential('self-hosted domain runtime apply', (): void => {
  const temporaryDirectories: string[] = [];

  beforeEach((): void => {
    vi.resetModules();
    mocks.ensureSelfHostedDockerExecutionContext.mockReset();
    mocks.reconcileNodeAgentRuntimeNetworks.mockReset();
    mocks.restartNodeAgentHostService.mockReset();
    mocks.restartSelfHostedRuntime.mockReset();
    mockDockerRuntime();
    mockNodeAgentService();
    mockNodeAgentRuntimeNetwork();
  });

  afterEach(async (): Promise<void> => {
    vi.doUnmock('../src/docker-runtime');
    vi.doUnmock('../src/node-agent-runtime-network');
    vi.doUnmock('../src/node-agent-service');
    vi.doUnmock('../src/self-hosted-docker-context');
    vi.doUnmock('../src/self-hosted-install-paths');
    await Promise.all(
      temporaryDirectories.map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
    temporaryDirectories.length = 0;
  });

  it('reconciles runtime network attachments after restarting Caddy for a domain apply', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeInstallFiles(installPaths, createEnvironmentText());
    mockSelfHostedPathSelection(installPaths);
    const { applySelfHostedSystemDomainRuntime } = await import('../src/self-hosted-domain-runtime');

    await applySelfHostedSystemDomainRuntime({ hostPlan: createCustomHttpHostPlan() });

    const updatedEnvironmentText: string = await readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_BASE_DOMAIN=customer.example.com');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_CADDY_TLS_MODE=custom-http');
    expect(mocks.restartSelfHostedRuntime.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.reconcileNodeAgentRuntimeNetworks.mock.invocationCallOrder[0]!,
    );
    expect(mocks.reconcileNodeAgentRuntimeNetworks).toHaveBeenCalledWith({
      environmentText: updatedEnvironmentText,
    });
  });

  it('restarts the node agent service and retries when domain runtime network reconcile fails', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeInstallFiles(installPaths, createEnvironmentText());
    mockSelfHostedPathSelection(installPaths);
    mocks.reconcileNodeAgentRuntimeNetworks
      .mockRejectedValueOnce(new Error('node socket unavailable'))
      .mockResolvedValueOnce(undefined);
    const { applySelfHostedSystemDomainRuntime } = await import('../src/self-hosted-domain-runtime');

    await applySelfHostedSystemDomainRuntime({ hostPlan: createCustomHttpHostPlan() });

    const updatedEnvironmentText: string = await readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8');
    expect(mocks.reconcileNodeAgentRuntimeNetworks).toHaveBeenCalledTimes(2);
    expect(mocks.restartNodeAgentHostService).toHaveBeenCalledWith({
      envPath: join(installPaths.configDir, '.env.self-hosted'),
    });
    expect(mocks.restartSelfHostedRuntime.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.reconcileNodeAgentRuntimeNetworks.mock.invocationCallOrder[0]!,
    );
    expect(mocks.reconcileNodeAgentRuntimeNetworks.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.restartNodeAgentHostService.mock.invocationCallOrder[0]!,
    );
    expect(mocks.restartNodeAgentHostService.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.reconcileNodeAgentRuntimeNetworks.mock.invocationCallOrder[1]!,
    );
    expect(mocks.reconcileNodeAgentRuntimeNetworks).toHaveBeenLastCalledWith({
      environmentText: updatedEnvironmentText,
    });
  });

  it('preserves both reconcile failures when the domain retry fails', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeInstallFiles(installPaths, createEnvironmentText());
    mockSelfHostedPathSelection(installPaths);
    const firstError: Error = new Error('node socket unavailable');
    const retryError: Error = new Error('node socket still unavailable');
    mocks.reconcileNodeAgentRuntimeNetworks.mockRejectedValueOnce(firstError).mockRejectedValueOnce(retryError);
    const { applySelfHostedSystemDomainRuntime } = await import('../src/self-hosted-domain-runtime');

    let thrownError: Error | undefined;
    try {
      await applySelfHostedSystemDomainRuntime({ hostPlan: createCustomHttpHostPlan() });
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(AggregateError);
    const aggregateError: AggregateError = thrownError as AggregateError;
    expect(aggregateError.message).toBe(
      'Runtime network reconciliation failed before and after restarting the node agent service.',
    );
    expect(aggregateError.errors).toEqual([firstError, retryError]);
    expect(mocks.restartNodeAgentHostService).toHaveBeenCalledWith({
      envPath: join(installPaths.configDir, '.env.self-hosted'),
    });
  });

  it('validates runtime network reconcile env before staging domain runtime changes', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const previousEnvironmentText: string = createEnvironmentText().replace(
      `COMPARTMENT_RUNTIME_CONTROL_TOKEN=${generatedSelfHosted24ByteSecret}\n`,
      '',
    );
    await writeInstallFiles(installPaths, previousEnvironmentText);
    mockSelfHostedPathSelection(installPaths);
    const { applySelfHostedSystemDomainRuntime } = await import('../src/self-hosted-domain-runtime');

    await expect(applySelfHostedSystemDomainRuntime({ hostPlan: createCustomHttpHostPlan() })).rejects.toThrow(
      'The self-hosted environment is missing COMPARTMENT_RUNTIME_CONTROL_TOKEN.',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
    expect(mocks.ensureSelfHostedDockerExecutionContext).not.toHaveBeenCalled();
    expect(mocks.restartSelfHostedRuntime).not.toHaveBeenCalled();
    expect(mocks.restartNodeAgentHostService).not.toHaveBeenCalled();
    expect(mocks.reconcileNodeAgentRuntimeNetworks).not.toHaveBeenCalled();
  });
});

function mockDockerRuntime(): void {
  vi.doMock(
    '../src/self-hosted-docker-context',
    (): { ensureSelfHostedDockerExecutionContext: Mock<EnsureSelfHostedDockerExecutionContext> } => ({
      ensureSelfHostedDockerExecutionContext: mocks.ensureSelfHostedDockerExecutionContext.mockResolvedValue({
        dockerCommand: ['docker'],
        isRootlessDocker: false,
        mode: 'direct',
      }),
    }),
  );
  vi.doMock('../src/docker-runtime', (): { restartSelfHostedRuntime: Mock<RestartSelfHostedRuntime> } => ({
    restartSelfHostedRuntime: mocks.restartSelfHostedRuntime.mockResolvedValue(undefined),
  }));
}

function mockNodeAgentRuntimeNetwork(): void {
  vi.doMock(
    '../src/node-agent-runtime-network',
    async (
      importOriginal: () => Promise<typeof NodeAgentRuntimeNetworkSourceModule>,
    ): Promise<typeof NodeAgentRuntimeNetworkSourceModule> => {
      const actualModule: typeof NodeAgentRuntimeNetworkSourceModule = await importOriginal();
      return {
        ...actualModule,
        reconcileNodeAgentRuntimeNetworks: mocks.reconcileNodeAgentRuntimeNetworks.mockResolvedValue(undefined),
      };
    },
  );
}

function mockNodeAgentService(): void {
  vi.doMock(
    '../src/node-agent-service',
    async (
      importOriginal: () => Promise<typeof NodeAgentServiceSourceModule>,
    ): Promise<typeof NodeAgentServiceSourceModule> => {
      const actualModule: typeof NodeAgentServiceSourceModule = await importOriginal();
      return {
        ...actualModule,
        restartNodeAgentHostService: mocks.restartNodeAgentHostService.mockResolvedValue(undefined),
      };
    },
  );
}

async function createTemporaryInstallPaths(temporaryDirectories: string[]): Promise<TemporaryInstallPaths> {
  const temporaryDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-domain-runtime-'));
  temporaryDirectories.push(temporaryDirectory);

  return {
    configDir: join(temporaryDirectory, 'etc'),
    dataDir: join(temporaryDirectory, 'var'),
  };
}

function mockSelfHostedPathSelection(installPaths: TemporaryInstallPaths): void {
  vi.doMock(
    '../src/self-hosted-install-paths',
    async (
      importOriginal: () => Promise<typeof SelfHostedInstallPathsSourceModule>,
    ): Promise<typeof SelfHostedInstallPathsSourceModule> => {
      const actualModule: typeof SelfHostedInstallPathsSourceModule = await importOriginal();
      return {
        ...actualModule,
        buildSelfHostedPathSelection: vi.fn<() => TemporaryInstallPaths>((): TemporaryInstallPaths => installPaths),
      };
    },
  );
}

async function writeInstallFiles(installPaths: TemporaryInstallPaths, environmentText: string): Promise<void> {
  await mkdir(installPaths.configDir, { recursive: true });
  await mkdir(join(installPaths.dataDir, 'self-hosted'), { recursive: true });
  await writeFile(join(installPaths.configDir, '.env.self-hosted'), environmentText, 'utf8');
  await writeFile(join(installPaths.configDir, 'docker-compose.self-hosted.yml'), 'services:\n', 'utf8');
  await writeFile(join(installPaths.configDir, 'docker-compose.self-hosted.local.yml'), 'services:\n', 'utf8');
  await writeFile(
    join(installPaths.dataDir, 'self-hosted/install-state.json'),
    `${JSON.stringify(
      {
        imageSource: 'registry',
        installationId: '11111111-1111-4111-8111-111111111111',
        stateVersion: 1,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function createEnvironmentText(): string {
  return `COMPARTMENT_ACME_CA_URL=
COMPARTMENT_ACME_EMAIL=admin@example.com
COMPARTMENT_API_IMAGE=ghcr.io/compartmentdev/compartment-api:0.2.0
COMPARTMENT_BUILDER_IMAGE=ghcr.io/compartmentdev/compartment-builder:0.2.0
COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD=${generatedSelfHosted24ByteSecret}
COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD=${generatedSelfHosted24ByteSecret}
COMPARTMENT_BASE_DOMAIN=localhost
COMPARTMENT_CADDY_IMAGE=ghcr.io/compartmentdev/compartment-caddy:0.2.0
COMPARTMENT_CADDY_TLS_MODE=internal
COMPARTMENT_CUSTOM_TLS_CERT_FILE=/var/lib/compartment/self-hosted/custom-tls/fullchain.pem
COMPARTMENT_CUSTOM_TLS_DIR=/var/lib/compartment/self-hosted/custom-tls
COMPARTMENT_CUSTOM_TLS_KEY_FILE=/var/lib/compartment/self-hosted/custom-tls/privkey.pem
COMPARTMENT_DATABASE_URL=postgres://postgres:${generatedSelfHosted24ByteSecret}@postgres:5432/compartment
COMPARTMENT_EDGE_IMAGE=ghcr.io/compartmentdev/compartment-edge:0.2.0
COMPARTMENT_EDGE_TOKEN=${generatedSelfHosted24ByteSecret}
COMPARTMENT_ENV=self-hosted
COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/node/agent.sock
COMPARTMENT_POSTGRES_PASSWORD=${generatedSelfHosted24ByteSecret}
COMPARTMENT_PUBLIC_PROTOCOL=http
COMPARTMENT_RUNTIME_CONTROL_TOKEN=${generatedSelfHosted24ByteSecret}
COMPARTMENT_RUNTIME_PROBE_IMAGE=ghcr.io/compartmentdev/compartment-runtime-probe:0.2.0
COMPARTMENT_SESSION_SECRET=${generatedSelfHostedVariablesMasterKey}
COMPARTMENT_SYSTEM_TOKEN=${generatedSelfHosted24ByteSecret}
COMPARTMENT_VARIABLES_MASTER_KEY=${generatedSelfHostedVariablesMasterKey}
COMPARTMENT_WORKER_IMAGE=ghcr.io/compartmentdev/compartment-worker:0.2.0
`;
}

function createCustomHttpHostPlan(): DomainHostPlan {
  return {
    baseDomain: 'customer.example.com',
    caddyMode: 'custom-http',
    domainKind: 'custom',
    publicScheme: 'http',
    tlsMode: 'external',
  };
}
