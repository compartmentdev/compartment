import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SystemRestartResponse, SystemServiceName, SystemStatusResponse } from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type * as SelfHostedInstallPathsSourceModule from '../src/self-hosted-install-paths';
import type {
  DockerExecutionContext,
  InspectSelfHostedRuntimeInput,
  SelfHostedRuntimeServiceInspection,
  RestartSelfHostedRuntimeInput,
} from '../src/docker-runtime.types';

type EnsureSelfHostedDockerExecutionContext = () => Promise<DockerExecutionContext>;
type InspectSelfHostedRuntimeServices = (
  context: DockerExecutionContext,
  input: InspectSelfHostedRuntimeInput,
) => Promise<SelfHostedRuntimeServiceInspection[]>;
type RestartSelfHostedSystemRuntime = (
  context: DockerExecutionContext,
  input: RestartSelfHostedRuntimeInput,
) => Promise<void>;
type ReadSelfHostedSystemServiceNames = () => readonly SystemServiceName[];
type RestartNodeAgentHostService = (input: object) => Promise<void>;
type WaitForNodeAgentHostServiceHealth = (input: object) => Promise<void>;
type EnsureSelfHostedRuntimeDirectories = () => Promise<void>;

interface SystemRuntimeMocks {
  ensureSelfHostedDockerExecutionContext: Mock<EnsureSelfHostedDockerExecutionContext>;
  inspectSelfHostedRuntimeServices: Mock<InspectSelfHostedRuntimeServices>;
  ensureSelfHostedRuntimeDirectories: Mock<EnsureSelfHostedRuntimeDirectories>;
  readSelfHostedSystemServiceNames: Mock<ReadSelfHostedSystemServiceNames>;
  restartNodeAgentHostService: Mock<RestartNodeAgentHostService>;
  restartSelfHostedSystemRuntime: Mock<RestartSelfHostedSystemRuntime>;
  waitForNodeAgentHostServiceHealth: Mock<WaitForNodeAgentHostServiceHealth>;
}

interface TemporaryInstallPaths {
  configDir: string;
  dataDir: string;
}

interface CurrentEnvironmentTextOptions {
  publicHttpPort?: number | undefined;
  publicHttpsPort?: number | undefined;
  publicProtocol?: 'http' | 'https' | undefined;
}

const mocks: SystemRuntimeMocks = vi.hoisted(
  (): SystemRuntimeMocks => ({
    ensureSelfHostedDockerExecutionContext: vi.fn<EnsureSelfHostedDockerExecutionContext>(),
    ensureSelfHostedRuntimeDirectories: vi.fn<EnsureSelfHostedRuntimeDirectories>(),
    inspectSelfHostedRuntimeServices: vi.fn<InspectSelfHostedRuntimeServices>(),
    readSelfHostedSystemServiceNames: vi.fn<ReadSelfHostedSystemServiceNames>(),
    restartNodeAgentHostService: vi.fn<RestartNodeAgentHostService>(),
    restartSelfHostedSystemRuntime: vi.fn<RestartSelfHostedSystemRuntime>(),
    waitForNodeAgentHostServiceHealth: vi.fn<WaitForNodeAgentHostServiceHealth>(),
  }),
);

describe.sequential('system maintenance runtime', (): void => {
  let temporaryDirectories: string[] = [];

  beforeEach((): void => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-09T12:00:00.000Z'));
    vi.resetModules();
    temporaryDirectories = [];
    mocks.ensureSelfHostedDockerExecutionContext.mockReset();
    mocks.inspectSelfHostedRuntimeServices.mockReset();
    mocks.ensureSelfHostedRuntimeDirectories.mockReset();
    mocks.ensureSelfHostedRuntimeDirectories.mockResolvedValue(undefined);
    mocks.readSelfHostedSystemServiceNames.mockReset();
    mocks.restartNodeAgentHostService.mockReset();
    mocks.restartSelfHostedSystemRuntime.mockReset();
    mocks.waitForNodeAgentHostServiceHealth.mockReset();
    mocks.ensureSelfHostedDockerExecutionContext.mockResolvedValue({
      dockerCommand: ['docker'],
      isRootlessDocker: false,
      mode: 'direct',
    });
    mocks.readSelfHostedSystemServiceNames.mockReturnValue([
      'api',
      'registry',
      'edge',
      'node',
      'builder',
      'worker',
      'caddy',
      'postgres',
    ]);
    vi.doMock(
      '../src/self-hosted-docker-context',
      (): { ensureSelfHostedDockerExecutionContext: Mock<EnsureSelfHostedDockerExecutionContext> } => ({
        ensureSelfHostedDockerExecutionContext: mocks.ensureSelfHostedDockerExecutionContext,
      }),
    );
    vi.doMock(
      '../src/docker-runtime',
      (): {
        inspectSelfHostedRuntimeServices: Mock<InspectSelfHostedRuntimeServices>;
        readSelfHostedSystemServiceNames: Mock<ReadSelfHostedSystemServiceNames>;
        restartSelfHostedSystemRuntime: Mock<RestartSelfHostedSystemRuntime>;
      } => ({
        inspectSelfHostedRuntimeServices: mocks.inspectSelfHostedRuntimeServices,
        readSelfHostedSystemServiceNames: mocks.readSelfHostedSystemServiceNames,
        restartSelfHostedSystemRuntime: mocks.restartSelfHostedSystemRuntime,
      }),
    );
    vi.doMock(
      '../src/self-hosted-runtime-directories',
      (): { ensureSelfHostedRuntimeDirectories: Mock<EnsureSelfHostedRuntimeDirectories> } => ({
        ensureSelfHostedRuntimeDirectories: mocks.ensureSelfHostedRuntimeDirectories,
      }),
    );
    vi.doMock(
      '../src/node-agent-service',
      (): {
        restartNodeAgentHostService: Mock<RestartNodeAgentHostService>;
        waitForNodeAgentHostServiceHealth: Mock<WaitForNodeAgentHostServiceHealth>;
      } => ({
        restartNodeAgentHostService: mocks.restartNodeAgentHostService.mockResolvedValue(undefined),
        waitForNodeAgentHostServiceHealth: mocks.waitForNodeAgentHostServiceHealth.mockResolvedValue(undefined),
      }),
    );
  });

  afterEach(async (): Promise<void> => {
    vi.useRealTimers();
    vi.doUnmock('../src/docker-runtime');
    vi.doUnmock('../src/node-agent-service');
    vi.doUnmock('../src/self-hosted-runtime-directories');
    vi.doUnmock('../src/self-hosted-install-paths');
    vi.doUnmock('../src/self-hosted-docker-context');
    await Promise.all(
      temporaryDirectories.map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
  });

  it('reports a running self-hosted system status', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeCurrentInstallFiles(installPaths, 'registry');
    mocks.inspectSelfHostedRuntimeServices.mockResolvedValueOnce(
      createServiceInspections({
        api: { health: 'healthy', status: 'running' },
        caddy: { health: null, status: 'running' },
        edge: { health: 'healthy', status: 'running' },
        node: { health: 'healthy', status: 'running' },
        builder: { health: 'healthy', status: 'running' },
        postgres: { health: 'healthy', status: 'running' },
        registry: { health: null, status: 'running' },
        worker: { health: null, status: 'running' },
      }),
    );
    const { getSelfHostedSystemStatus } = await import('../src/system-status');

    const result: SystemStatusResponse = await getSelfHostedSystemStatus({});

    expect(result.overallStatus).toBe('running');
    expect(result.domain).toEqual({
      cliApiUrl: 'http://127.0.0.1:39444',
      controlPlaneUrl: 'https://console.customer.example.com',
    });
    expect(result.dockerNamespace).toBe('compartment-prod');
    expect(result.imageSource).toBe('registry');
    expect(result.services[0]?.uptimeSeconds).toBe(3600);
    expect(mocks.inspectSelfHostedRuntimeServices).toHaveBeenCalledWith(
      expect.objectContaining({ dockerCommand: ['docker'] }),
      expect.objectContaining({
        nodeSocketPath: '/var/run/compartment/node/agent.sock',
      }),
    );
  });

  it('requires the node agent socket in status env files', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeCurrentInstallFiles(
      installPaths,
      'registry',
      createCurrentEnvironmentText().replace(
        'COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/node/agent.sock\n',
        '',
      ),
    );
    mocks.inspectSelfHostedRuntimeServices.mockResolvedValueOnce(createServiceInspections({}));
    const { getSelfHostedSystemStatus } = await import('../src/system-status');

    await expect(getSelfHostedSystemStatus({})).rejects.toThrow(
      'The self-hosted environment is missing COMPARTMENT_NODE_AGENT_SOCKET.',
    );
    expect(mocks.inspectSelfHostedRuntimeServices).not.toHaveBeenCalled();
  });

  it('rejects noncanonical node agent sockets in status env files', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeCurrentInstallFiles(
      installPaths,
      'registry',
      createCurrentEnvironmentText().replace(
        'COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/node/agent.sock',
        'COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/custom-node/agent.sock',
      ),
    );
    mocks.inspectSelfHostedRuntimeServices.mockResolvedValueOnce(createServiceInspections({}));
    const { getSelfHostedSystemStatus } = await import('../src/system-status');

    await expect(getSelfHostedSystemStatus({})).rejects.toThrow(
      'The self-hosted environment has unsupported COMPARTMENT_NODE_AGENT_SOCKET value /var/run/compartment/custom-node/agent.sock. Expected /var/run/compartment/node/agent.sock.',
    );
    expect(mocks.inspectSelfHostedRuntimeServices).not.toHaveBeenCalled();
  });

  it('reports degraded when at least one service is unhealthy', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeCurrentInstallFiles(installPaths, 'registry');
    mocks.inspectSelfHostedRuntimeServices.mockResolvedValueOnce(
      createServiceInspections({
        api: { health: 'unhealthy', status: 'running' },
        caddy: { health: null, status: 'running' },
        edge: { health: 'healthy', status: 'running' },
        node: { health: 'healthy', status: 'running' },
        builder: { health: 'healthy', status: 'running' },
        postgres: { health: 'healthy', status: 'running' },
        registry: { health: null, status: 'running' },
        worker: { health: null, status: 'running' },
      }),
    );
    const { getSelfHostedSystemStatus } = await import('../src/system-status');

    const result: SystemStatusResponse = await getSelfHostedSystemStatus({});

    expect(result.overallStatus).toBe('degraded');
  });

  it('includes a configured non-default public port in the control plane url', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeCurrentInstallFiles(
      installPaths,
      'registry',
      createCurrentEnvironmentText({ publicHttpsPort: 9443, publicProtocol: 'https' }),
    );
    mocks.inspectSelfHostedRuntimeServices.mockResolvedValueOnce(
      createServiceInspections({
        api: { health: 'healthy', status: 'running' },
        caddy: { health: null, status: 'running' },
        edge: { health: 'healthy', status: 'running' },
        node: { health: 'healthy', status: 'running' },
        builder: { health: 'healthy', status: 'running' },
        postgres: { health: 'healthy', status: 'running' },
        registry: { health: null, status: 'running' },
        worker: { health: null, status: 'running' },
      }),
    );
    const { getSelfHostedSystemStatus } = await import('../src/system-status');

    const result: SystemStatusResponse = await getSelfHostedSystemStatus({});

    expect(result.domain.controlPlaneUrl).toBe('https://console.customer.example.com:9443');
  });

  it('reports stopped when all services are inactive', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeCurrentInstallFiles(installPaths, 'registry');
    mocks.inspectSelfHostedRuntimeServices.mockResolvedValueOnce(
      createServiceInspections({
        api: { containerId: null, imageRef: null, startedAt: null, status: 'missing' },
        caddy: { containerId: null, imageRef: null, startedAt: null, status: 'missing' },
        edge: { containerId: null, imageRef: null, startedAt: null, status: 'missing' },
        node: { containerId: null, imageRef: null, startedAt: null, status: 'missing' },
        builder: { containerId: null, imageRef: null, startedAt: null, status: 'missing' },
        postgres: { startedAt: null, status: 'exited' },
        registry: { containerId: null, imageRef: null, startedAt: null, status: 'missing' },
        worker: { containerId: null, imageRef: null, startedAt: null, status: 'missing' },
      }),
    );
    const { getSelfHostedSystemStatus } = await import('../src/system-status');

    const result: SystemStatusResponse = await getSelfHostedSystemStatus({});

    expect(result.overallStatus).toBe('stopped');
  });

  it('restarts the self-hosted system with the stored image source', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeCurrentInstallFiles(installPaths, 'local');
    const { restartSelfHostedSystem } = await import('../src/system-restart');

    const result: SystemRestartResponse = await restartSelfHostedSystem({});

    expect(mocks.restartSelfHostedSystemRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ dockerCommand: ['docker'] }),
      expect.objectContaining({
        imageSource: 'local',
        installDirectory: installPaths.configDir,
      }),
    );
    expect(mocks.ensureSelfHostedRuntimeDirectories.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.restartNodeAgentHostService.mock.invocationCallOrder[0]!,
    );
    expect(mocks.restartNodeAgentHostService.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.restartSelfHostedSystemRuntime.mock.invocationCallOrder[0]!,
    );
    expect(mocks.restartSelfHostedSystemRuntime.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.waitForNodeAgentHostServiceHealth.mock.invocationCallOrder[0]!,
    );
    expect(mocks.restartNodeAgentHostService).toHaveBeenCalledWith({
      envPath: join(installPaths.configDir, '.env.self-hosted'),
      waitForHealth: false,
    });
    expect(mocks.waitForNodeAgentHostServiceHealth).toHaveBeenCalledWith({
      envPath: join(installPaths.configDir, '.env.self-hosted'),
    });
    expect(result.services).toEqual(['api', 'registry', 'edge', 'node', 'builder', 'worker', 'caddy', 'postgres']);
    expect(result.restartedAt).toBe('2026-04-09T12:00:00.000Z');
  });

  it('fails fast when the install state is missing', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await mkdir(installPaths.configDir, { recursive: true });
    await mkdir(join(installPaths.dataDir, 'self-hosted'), { recursive: true });
    await writeFile(join(installPaths.configDir, '.env.self-hosted'), createCurrentEnvironmentText(), 'utf8');
    const { restartSelfHostedSystem } = await import('../src/system-restart');

    await expect(restartSelfHostedSystem({})).rejects.toThrow(
      `Expected an existing self-hosted install state at ${join(installPaths.dataDir, 'self-hosted/install-state.json')}. Reinstall the runtime with \`compartment install\`.`,
    );
    expect(mocks.ensureSelfHostedDockerExecutionContext).not.toHaveBeenCalled();
  });
});

async function createTemporaryInstallPaths(temporaryDirectories: string[]): Promise<TemporaryInstallPaths> {
  const temporaryDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-system-runtime-'));
  temporaryDirectories.push(temporaryDirectory);
  const installPaths: TemporaryInstallPaths = {
    configDir: join(temporaryDirectory, 'etc'),
    dataDir: join(temporaryDirectory, 'var'),
  };
  mockRootPrivileges();
  mockSelfHostedPathSelection(installPaths);
  return installPaths;
}

function mockRootPrivileges(): void {
  const processWithGetuid: NodeJS.Process & { getuid: () => number } = process as NodeJS.Process & {
    getuid: () => number;
  };
  vi.spyOn(processWithGetuid, 'getuid').mockReturnValue(0);
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

async function writeCurrentInstallFiles(
  installPaths: TemporaryInstallPaths,
  imageSource: 'local' | 'registry',
  environmentText: string = createCurrentEnvironmentText(),
): Promise<void> {
  await mkdir(installPaths.configDir, { recursive: true });
  await mkdir(join(installPaths.dataDir, 'self-hosted'), { recursive: true });
  await writeFile(join(installPaths.configDir, '.env.self-hosted'), environmentText, 'utf8');
  await writeFile(
    join(installPaths.dataDir, 'self-hosted/install-state.json'),
    `${JSON.stringify(
      {
        imageSource,
        installationId: '11111111-1111-4111-8111-111111111111',
        stateVersion: 1,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function createCurrentEnvironmentText(options: CurrentEnvironmentTextOptions = {}): string {
  const publicHttpPort: number = options.publicHttpPort ?? 80;
  const publicHttpsPort: number = options.publicHttpsPort ?? 443;
  const publicProtocol: 'http' | 'https' = options.publicProtocol ?? 'https';

  return `COMPARTMENT_DOCKER_NAMESPACE=compartment-prod
COMPARTMENT_BASE_DOMAIN=customer.example.com
COMPARTMENT_PUBLIC_PROTOCOL=${publicProtocol}
COMPARTMENT_PUBLIC_HTTP_PORT=${publicHttpPort.toString()}
COMPARTMENT_PUBLIC_HTTPS_PORT=${publicHttpsPort.toString()}
COMPARTMENT_API_URL=http://127.0.0.1:39444
COMPARTMENT_API_IMAGE=ghcr.io/compartmentdev/compartment-api:0.2.0
COMPARTMENT_CADDY_IMAGE=ghcr.io/compartmentdev/compartment-caddy:0.2.0
COMPARTMENT_EDGE_IMAGE=ghcr.io/compartmentdev/compartment-edge:0.2.0
COMPARTMENT_RUNTIME_PROBE_IMAGE=ghcr.io/compartmentdev/compartment-runtime-probe:0.2.0
COMPARTMENT_WORKER_IMAGE=ghcr.io/compartmentdev/compartment-worker:0.2.0
COMPARTMENT_NODE_VERSION=0.2.0
COMPARTMENT_ROLLBACK_RETENTION_LIMIT=
COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/node/agent.sock
COMPARTMENT_ENV=self-hosted`;
}

function createServiceInspections(
  overrides: Partial<Record<SystemServiceName, Partial<SelfHostedRuntimeServiceInspection>>>,
): SelfHostedRuntimeServiceInspection[] {
  return (['api', 'registry', 'edge', 'node', 'builder', 'worker', 'caddy', 'postgres'] as const).map(
    (serviceName: SystemServiceName): SelfHostedRuntimeServiceInspection => ({
      containerId: `container_${serviceName}`,
      health: serviceName === 'worker' || serviceName === 'caddy' || serviceName === 'registry' ? null : 'healthy',
      imageRef: `ghcr.io/compartmentdev/compartment-${serviceName}:0.2.0`,
      name: serviceName,
      publishedPorts:
        serviceName === 'postgres' || serviceName === 'builder'
          ? []
          : [{ containerPort: 3000, hostIp: '127.0.0.1', hostPort: 3100 }],
      startedAt: '2026-04-09T11:00:00.000Z',
      status: 'running',
      ...overrides[serviceName],
    }),
  );
}
