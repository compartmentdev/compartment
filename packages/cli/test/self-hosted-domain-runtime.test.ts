import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DomainHostPlan } from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { DockerExecutionContext, RestartSelfHostedRuntimeInput } from '../src/docker-runtime.types';
import type * as NodeAgentRuntimeNetworkSourceModule from '../src/node-agent-runtime-network';
import type * as SelfHostedInstallPathsSourceModule from '../src/self-hosted-install-paths';

type EnsureSelfHostedDockerExecutionContext = () => Promise<DockerExecutionContext>;
type ReconcileNodeAgentRuntimeNetworks = (input: object) => Promise<void>;
type RestartSelfHostedRuntime = (
  context: DockerExecutionContext,
  input: RestartSelfHostedRuntimeInput,
) => Promise<void>;

interface DomainRuntimeMocks {
  ensureSelfHostedDockerExecutionContext: Mock<EnsureSelfHostedDockerExecutionContext>;
  reconcileNodeAgentRuntimeNetworks: Mock<ReconcileNodeAgentRuntimeNetworks>;
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
    restartSelfHostedRuntime: vi.fn<RestartSelfHostedRuntime>(),
  }),
);

describe.sequential('self-hosted domain runtime apply', (): void => {
  const temporaryDirectories: string[] = [];

  beforeEach((): void => {
    vi.resetModules();
    mocks.ensureSelfHostedDockerExecutionContext.mockReset();
    mocks.reconcileNodeAgentRuntimeNetworks.mockReset();
    mocks.restartSelfHostedRuntime.mockReset();
    mockDockerRuntime();
    mockNodeAgentRuntimeNetwork();
  });

  afterEach(async (): Promise<void> => {
    vi.doUnmock('../src/docker-runtime');
    vi.doUnmock('../src/node-agent-runtime-network');
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

  it('validates runtime network reconcile env before staging domain runtime changes', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const previousEnvironmentText: string = createEnvironmentText().replace(
      'COMPARTMENT_RUNTIME_CONTROL_TOKEN=runtime-token\n',
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
COMPARTMENT_BASE_DOMAIN=localhost
COMPARTMENT_CADDY_IMAGE=ghcr.io/compartmentdev/compartment-caddy:0.2.0
COMPARTMENT_CADDY_TLS_MODE=internal
COMPARTMENT_CUSTOM_TLS_CERT_FILE=/var/lib/compartment/self-hosted/custom-tls/fullchain.pem
COMPARTMENT_CUSTOM_TLS_DIR=/var/lib/compartment/self-hosted/custom-tls
COMPARTMENT_CUSTOM_TLS_KEY_FILE=/var/lib/compartment/self-hosted/custom-tls/privkey.pem
COMPARTMENT_EDGE_IMAGE=ghcr.io/compartmentdev/compartment-edge:0.2.0
COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/node/agent.sock
COMPARTMENT_PUBLIC_PROTOCOL=http
COMPARTMENT_RUNTIME_CONTROL_TOKEN=runtime-token
COMPARTMENT_RUNTIME_PROBE_IMAGE=ghcr.io/compartmentdev/compartment-runtime-probe:0.2.0
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
