import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, vi, type Mock } from 'vitest';
import type { CliBuildInfo } from '../src/cli-build-info.types';
import type {
  DockerExecutionContext,
  PrepareSelfHostedRuntimeImagesInput,
  RestartSelfHostedRuntimeInput,
} from '../src/docker-runtime.types';
import type * as NodeAgentRuntimeNetworkSourceModule from '../src/node-agent-runtime-network';
import type * as SelfHostedInstallPathsSourceModule from '../src/self-hosted-install-paths';
import type { SelfHostedInstallState } from '../src/self-hosted-install-state.types';

export const generatedSelfHosted24ByteSecret: string = '0123456789abcdef0123456789abcdef0123456789abcdef';
export const generatedSelfHostedVariablesMasterKey: string =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
export const generatedSelfHostedAlternateVariablesMasterKey: string =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

type AssertNodeAgentHostServiceInstallable = () => void;
type EnsureDockerExecutionContext = () => Promise<DockerExecutionContext>;
type InstallStateJsonValue = InstallStateJsonObject | InstallStateJsonValue[] | boolean | null | number | string;
type PrepareSelfHostedRuntimeImages = (
  context: DockerExecutionContext,
  input: PrepareSelfHostedRuntimeImagesInput,
) => Promise<void>;
type ReadCliBuildInfo = () => CliBuildInfo;
type ReconcileNodeAgentRuntimeNetworks = (input: ReconcileNodeAgentRuntimeNetworksInput) => Promise<void>;
type RestartNodeAgentHostService = (input: object) => Promise<void>;
type RestartSelfHostedRuntime = (
  context: DockerExecutionContext,
  input: RestartSelfHostedRuntimeInput,
) => Promise<void>;
type StageNodeAgentHostService = (input: object) => Promise<void>;
type StopNodeAgentHostService = () => Promise<void>;
type StopSelfHostedRuntime = (context: DockerExecutionContext, input: RestartSelfHostedRuntimeInput) => Promise<void>;
type WaitForNodeAgentHostServiceHealth = (input: object) => Promise<void>;

interface CreateCurrentEnvironmentTextOptions {
  acmeCaUrl?: string | undefined;
  acmeEmail?: string | undefined;
  baseDomain?: string | undefined;
  buildKitAddress?: string | undefined;
  caddyTlsMode?: string | undefined;
  includeRuntimeControlToken?: boolean | undefined;
  includeVariablesMasterKey?: boolean | undefined;
  logLevel?: string | undefined;
  managedDomainBrokerToken?: string | undefined;
  managedDomainBrokerUrl?: string | undefined;
  nodeVersion?: string | undefined;
  publicIngressIpv4?: string | undefined;
  publicIngressIpv6?: string | undefined;
  publicProtocol?: string | undefined;
  variablesMasterKey?: string | undefined;
}

export interface ReconcileNodeAgentRuntimeNetworksInput {
  environmentText: string;
}

interface CliBuildInfoModule {
  readCliBuildInfo: Mock<ReadCliBuildInfo>;
}

interface DockerRuntimeModule {
  ensureDockerExecutionContext: Mock<EnsureDockerExecutionContext>;
  prepareSelfHostedRuntimeImages: Mock<PrepareSelfHostedRuntimeImages>;
  restartSelfHostedRuntime: Mock<RestartSelfHostedRuntime>;
  stopSelfHostedRuntime: Mock<StopSelfHostedRuntime>;
}

export interface InstallStateJsonObject {
  [key: string]: InstallStateJsonValue | undefined;
}

interface NodeAgentServiceModule {
  assertNodeAgentHostServiceInstallable: Mock<AssertNodeAgentHostServiceInstallable>;
  restartNodeAgentHostService: Mock<RestartNodeAgentHostService>;
  stageNodeAgentHostService: Mock<StageNodeAgentHostService>;
  stopNodeAgentHostService: Mock<StopNodeAgentHostService>;
  waitForNodeAgentHostServiceHealth: Mock<WaitForNodeAgentHostServiceHealth>;
}

interface ProcessWithGetuid extends NodeJS.Process {
  getuid: () => number;
}

export interface TemporaryInstallPaths {
  configDir: string;
  dataDir: string;
}

interface UpdateRuntimeTestHarnessOptions {
  temporaryDirectoryPrefix: string;
}

interface UpdateRuntimeMocks {
  assertNodeAgentHostServiceInstallable: Mock<AssertNodeAgentHostServiceInstallable>;
  ensureDockerExecutionContext: Mock<EnsureDockerExecutionContext>;
  prepareSelfHostedRuntimeImages: Mock<PrepareSelfHostedRuntimeImages>;
  reconcileNodeAgentRuntimeNetworks: Mock<ReconcileNodeAgentRuntimeNetworks>;
  restartNodeAgentHostService: Mock<RestartNodeAgentHostService>;
  restartSelfHostedRuntime: Mock<RestartSelfHostedRuntime>;
  stageNodeAgentHostService: Mock<StageNodeAgentHostService>;
  stopNodeAgentHostService: Mock<StopNodeAgentHostService>;
  stopSelfHostedRuntime: Mock<StopSelfHostedRuntime>;
  waitForNodeAgentHostServiceHealth: Mock<WaitForNodeAgentHostServiceHealth>;
}

class UpdateRuntimeTestHarness {
  public readonly createCurrentEnvironmentText: (options?: CreateCurrentEnvironmentTextOptions) => string =
    createCurrentEnvironmentText;
  public readonly createTemporaryInstallPaths: () => Promise<TemporaryInstallPaths> =
    async (): Promise<TemporaryInstallPaths> => {
      const temporaryDirectory: string = await mkdtemp(join(tmpdir(), this.options.temporaryDirectoryPrefix));
      this.temporaryDirectories.push(temporaryDirectory);
      const installPaths: TemporaryInstallPaths = {
        configDir: join(temporaryDirectory, 'etc'),
        dataDir: join(temporaryDirectory, 'var'),
      };
      mockRootPrivileges();
      mockSelfHostedPathSelection(installPaths);
      return installPaths;
    };
  public readonly expectUpdateFailureLeavesEnvironment: (
    installPaths: TemporaryInstallPaths,
    previousEnvironmentText: string,
    expectedMessage: string,
  ) => Promise<void> = async (
    installPaths: TemporaryInstallPaths,
    previousEnvironmentText: string,
    expectedMessage: string,
  ): Promise<void> => {
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow(expectedMessage);
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
  };
  public readonly mocks: UpdateRuntimeMocks;
  public readonly removeEnvironmentAssignments: (environmentText: string, variableNames: readonly string[]) => string =
    removeEnvironmentAssignments;
  public readonly replaceEnvironmentAssignment: (
    environmentText: string,
    variableName: string,
    value: string,
  ) => string = replaceEnvironmentAssignment;
  public readonly writeBaselineInstallState: (installPaths: TemporaryInstallPaths) => Promise<void> =
    writeBaselineInstallState;
  public readonly writeCurrentInstallFiles: (
    installPaths: TemporaryInstallPaths,
    environmentText: string,
  ) => Promise<void> = writeCurrentInstallFiles;
  public readonly writeInstallState: (
    installPaths: TemporaryInstallPaths,
    state: SelfHostedInstallState,
  ) => Promise<void> = writeInstallState;
  public readonly writeInstallStateJson: (
    installPaths: TemporaryInstallPaths,
    state: InstallStateJsonObject | SelfHostedInstallState,
  ) => Promise<void> = writeInstallStateJson;
  public readonly writeInvalidInstallStateWithoutInstallationId: (
    installPaths: TemporaryInstallPaths,
  ) => Promise<void> = writeInvalidInstallStateWithoutInstallationId;
  public readonly writeManagedDomainInstallState: (installPaths: TemporaryInstallPaths) => Promise<void> =
    writeManagedDomainInstallState;
  private readonly options: UpdateRuntimeTestHarnessOptions;
  private temporaryDirectories: string[] = [];

  public constructor(options: UpdateRuntimeTestHarnessOptions) {
    this.options = options;
    this.mocks = createUpdateRuntimeMocks();

    beforeEach((): void => {
      vi.resetModules();
      this.temporaryDirectories = [];
      resetUpdateRuntimeMocks(this.mocks);
      mockCliBuildInfo();
      mockDockerRuntime(this.mocks);
      mockNodeAgentService(this.mocks);
      mockNodeAgentRuntimeNetwork(this.mocks);
    });

    afterEach(async (): Promise<void> => {
      vi.doUnmock('../src/cli-build-info');
      vi.doUnmock('../src/docker-runtime');
      vi.doUnmock('../src/node-agent-service');
      vi.doUnmock('../src/node-agent-runtime-network');
      vi.doUnmock('../src/self-hosted-install-paths');
      await Promise.all(
        this.temporaryDirectories.map(async (directory: string): Promise<void> => {
          await rm(directory, { force: true, recursive: true });
        }),
      );
    });
  }
}

export function createUpdateRuntimeTestHarness(options: UpdateRuntimeTestHarnessOptions): UpdateRuntimeTestHarness {
  return new UpdateRuntimeTestHarness(options);
}

function createUpdateRuntimeMocks(): UpdateRuntimeMocks {
  return {
    assertNodeAgentHostServiceInstallable: vi.fn<AssertNodeAgentHostServiceInstallable>(),
    ensureDockerExecutionContext: vi.fn<EnsureDockerExecutionContext>(),
    prepareSelfHostedRuntimeImages: vi.fn<PrepareSelfHostedRuntimeImages>(),
    reconcileNodeAgentRuntimeNetworks: vi.fn<ReconcileNodeAgentRuntimeNetworks>(),
    restartNodeAgentHostService: vi.fn<RestartNodeAgentHostService>(),
    restartSelfHostedRuntime: vi.fn<RestartSelfHostedRuntime>(),
    stageNodeAgentHostService: vi.fn<StageNodeAgentHostService>(),
    stopNodeAgentHostService: vi.fn<StopNodeAgentHostService>(),
    stopSelfHostedRuntime: vi.fn<StopSelfHostedRuntime>(),
    waitForNodeAgentHostServiceHealth: vi.fn<WaitForNodeAgentHostServiceHealth>(),
  };
}

function resetUpdateRuntimeMocks(mocks: UpdateRuntimeMocks): void {
  mocks.assertNodeAgentHostServiceInstallable.mockReset();
  mocks.ensureDockerExecutionContext.mockReset();
  mocks.prepareSelfHostedRuntimeImages.mockReset();
  mocks.reconcileNodeAgentRuntimeNetworks.mockReset();
  mocks.restartNodeAgentHostService.mockReset();
  mocks.restartSelfHostedRuntime.mockReset();
  mocks.stageNodeAgentHostService.mockReset();
  mocks.stopNodeAgentHostService.mockReset();
  mocks.stopSelfHostedRuntime.mockReset();
  mocks.waitForNodeAgentHostServiceHealth.mockReset();
}

function mockNodeAgentRuntimeNetwork(mocks: UpdateRuntimeMocks): void {
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

function mockCliBuildInfo(): void {
  vi.doMock(
    '../src/cli-build-info',
    (): CliBuildInfoModule => ({
      readCliBuildInfo: vi.fn<ReadCliBuildInfo>().mockReturnValue({
        cliVersion: '0.1.0',
        defaultRegistryImageTag: '1.2.3',
        distributionChannel: 'source',
      }),
    }),
  );
}

function mockDockerRuntime(mocks: UpdateRuntimeMocks): void {
  vi.doMock(
    '../src/docker-runtime',
    (): DockerRuntimeModule => ({
      ensureDockerExecutionContext: mocks.ensureDockerExecutionContext.mockResolvedValue({
        dockerCommand: ['docker'],
        isRootlessDocker: false,
        mode: 'direct',
      }),
      prepareSelfHostedRuntimeImages: mocks.prepareSelfHostedRuntimeImages.mockResolvedValue(undefined),
      restartSelfHostedRuntime: mocks.restartSelfHostedRuntime.mockResolvedValue(undefined),
      stopSelfHostedRuntime: mocks.stopSelfHostedRuntime.mockResolvedValue(undefined),
    }),
  );
}

function mockNodeAgentService(mocks: UpdateRuntimeMocks): void {
  vi.doMock(
    '../src/node-agent-service',
    (): NodeAgentServiceModule => ({
      assertNodeAgentHostServiceInstallable: mocks.assertNodeAgentHostServiceInstallable,
      restartNodeAgentHostService: mocks.restartNodeAgentHostService.mockResolvedValue(undefined),
      stageNodeAgentHostService: mocks.stageNodeAgentHostService.mockResolvedValue(undefined),
      stopNodeAgentHostService: mocks.stopNodeAgentHostService.mockResolvedValue(undefined),
      waitForNodeAgentHostServiceHealth: mocks.waitForNodeAgentHostServiceHealth.mockResolvedValue(undefined),
    }),
  );
}

function mockRootPrivileges(): void {
  const processWithGetuid: ProcessWithGetuid = process as ProcessWithGetuid;
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

function createCurrentEnvironmentText(options: CreateCurrentEnvironmentTextOptions = {}): string {
  const values: string[] = [
    'COMPARTMENT_ENV=self-hosted',
    `BUILDKIT_ADDR=${options.buildKitAddress ?? 'tcp://builder:1234'}`,
    'COMPARTMENT_API_BIND_HOST=0.0.0.0',
    'COMPARTMENT_API_IMAGE=ghcr.io/compartmentdev/compartment-api:0.1.0',
    'COMPARTMENT_RUNTIME_PROBE_IMAGE=ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
    'COMPARTMENT_API_INTERNAL_HOST=api',
    'COMPARTMENT_API_PORT=39444',
    'COMPARTMENT_API_URL=http://127.0.0.1:39444',
    `COMPARTMENT_ACME_CA_URL=${options.acmeCaUrl ?? ''}`,
    `COMPARTMENT_ACME_EMAIL=${options.acmeEmail ?? 'admin@example.com'}`,
    'COMPARTMENT_ARTIFACT_REGISTRY_HOST=127.0.0.1',
    'COMPARTMENT_ARTIFACT_REGISTRY_PORT=39461',
    'COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST=registry-auth',
    'COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_PORT=5000',
    'COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME=compartment-reader',
    renderEnvironmentAssignment('COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD', generatedSelfHosted24ByteSecret),
    'COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME=compartment-writer',
    renderEnvironmentAssignment('COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD', generatedSelfHosted24ByteSecret),
    `COMPARTMENT_BASE_DOMAIN=${options.baseDomain ?? 'example.com'}`,
    `COMPARTMENT_CADDY_TLS_MODE=${options.caddyTlsMode ?? 'internal'}`,
    'COMPARTMENT_CUSTOM_TLS_CERT_FILE=/var/lib/compartment/self-hosted/custom-tls/fullchain.pem',
    'COMPARTMENT_CUSTOM_TLS_DIR=/var/lib/compartment/self-hosted/custom-tls',
    'COMPARTMENT_CUSTOM_TLS_KEY_FILE=/var/lib/compartment/self-hosted/custom-tls/privkey.pem',
    `COMPARTMENT_DATABASE_URL=postgresql://postgres:${generatedSelfHosted24ByteSecret}@postgres:5432/compartment`,
    'COMPARTMENT_DOCKER_NAMESPACE=compartment-test',
    'COMPARTMENT_DOCKER_WORK_DIR=/var/lib/compartment/self-hosted/docker-work',
    'COMPARTMENT_EDGE_BIND_HOST=0.0.0.0',
    'COMPARTMENT_EDGE_IMAGE=ghcr.io/compartmentdev/compartment-edge:0.1.0',
    'COMPARTMENT_EDGE_INTERNAL_HOST=edge',
    'COMPARTMENT_EDGE_PORT=39081',
    `COMPARTMENT_EDGE_TOKEN=${generatedSelfHosted24ByteSecret}`,
    `COMPARTMENT_LOG_LEVEL=${options.logLevel ?? 'info'}`,
    `COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=${options.managedDomainBrokerToken ?? ''}`,
    `COMPARTMENT_MANAGED_DOMAIN_BROKER_URL=${options.managedDomainBrokerUrl ?? ''}`,
    `COMPARTMENT_PUBLIC_PROTOCOL=${options.publicProtocol ?? 'http'}`,
    'COMPARTMENT_NODE_APP_PORT_END=31999',
    'COMPARTMENT_NODE_APP_PORT_START=31000',
    'COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/node/agent.sock',
    'COMPARTMENT_NODE_NAME=self-hosted-node',
    `COMPARTMENT_NODE_VERSION=${options.nodeVersion ?? '0.1.0'}`,
    'COMPARTMENT_POSTGRES_DB=compartment',
    `COMPARTMENT_POSTGRES_PASSWORD=${generatedSelfHosted24ByteSecret}`,
    'COMPARTMENT_POSTGRES_USER=postgres',
    'COMPARTMENT_PUBLIC_HTTP_PORT=80',
    'COMPARTMENT_PUBLIC_HTTPS_PORT=443',
    `COMPARTMENT_PUBLIC_INGRESS_IPV4=${options.publicIngressIpv4 ?? ''}`,
    `COMPARTMENT_PUBLIC_INGRESS_IPV6=${options.publicIngressIpv6 ?? ''}`,
    'COMPARTMENT_CADDY_IMAGE=ghcr.io/compartmentdev/compartment-caddy:0.1.0',
    'COMPARTMENT_RUNTIME_CONNECTIVITY_MODE=network',
    'COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST=host.docker.internal',
    `COMPARTMENT_SESSION_SECRET=${generatedSelfHostedVariablesMasterKey}`,
    'COMPARTMENT_SESSION_TTL=7d',
    'COMPARTMENT_SOURCE_ARCHIVE_DIR=/var/lib/compartment/source-archives',
    'COMPARTMENT_SOURCE_ARCHIVE_MAX_BYTES=104857600',
    'COMPARTMENT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/compartment_test',
    'COMPARTMENT_WORKER_POLL_INTERVAL_MS=1000',
    'COMPARTMENT_WORKER_IMAGE=ghcr.io/compartmentdev/compartment-worker:0.1.0',
  ];

  if (options.includeRuntimeControlToken !== false) {
    values.push(`COMPARTMENT_RUNTIME_CONTROL_TOKEN=${generatedSelfHosted24ByteSecret}`);
  }
  if (options.includeVariablesMasterKey !== false) {
    values.push(
      `COMPARTMENT_VARIABLES_MASTER_KEY=${options.variablesMasterKey ?? generatedSelfHostedVariablesMasterKey}`,
    );
  }
  values.push('COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/api/system-api.sock');
  values.push(`COMPARTMENT_SYSTEM_TOKEN=${generatedSelfHosted24ByteSecret}`);

  return `${values.join('\n')}\n`;
}

async function writeCurrentInstallFiles(installPaths: TemporaryInstallPaths, environmentText: string): Promise<void> {
  await mkdir(installPaths.configDir, { recursive: true });
  const envPath: string = join(installPaths.configDir, '.env.self-hosted');
  await writeFile(envPath, environmentText, 'utf8');
  await chmod(envPath, 0o644);
  await writeFile(join(installPaths.configDir, 'docker-compose.self-hosted.yml'), 'services:\n', 'utf8');
  await writeFile(join(installPaths.configDir, 'docker-compose.self-hosted.local.yml'), 'services:\n', 'utf8');
}

async function writeInstallState(installPaths: TemporaryInstallPaths, state: SelfHostedInstallState): Promise<void> {
  await writeInstallStateJson(installPaths, state);
}

async function writeInstallStateJson(
  installPaths: TemporaryInstallPaths,
  state: InstallStateJsonObject | SelfHostedInstallState,
): Promise<void> {
  await mkdir(join(installPaths.dataDir, 'self-hosted'), { recursive: true });
  await writeFile(
    join(installPaths.dataDir, 'self-hosted/install-state.json'),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  );
}

async function writeBaselineInstallState(installPaths: TemporaryInstallPaths): Promise<void> {
  await writeInstallState(installPaths, {
    imageSource: 'registry',
    installationId: '11111111-1111-4111-8111-111111111111',
    stateVersion: 1,
  });
}

async function writeInvalidInstallStateWithoutInstallationId(installPaths: TemporaryInstallPaths): Promise<void> {
  await writeInstallStateJson(installPaths, {
    imageSource: 'registry',
    stateVersion: 1,
  });
}

async function writeManagedDomainInstallState(installPaths: TemporaryInstallPaths): Promise<void> {
  await writeInstallState(installPaths, {
    imageSource: 'registry',
    installationId: '11111111-1111-4111-8111-111111111111',
    managedDomain: {
      acmeEmail: 'admin@example.com',
      baseDomain: '4h8z9k2m1p7q.app.compartment.run',
      brokerUrl: 'http://127.0.0.1:4545',
      managedDomainBrokerToken: 'acme-token',
    },
    stateVersion: 1,
  });
}

function removeEnvironmentAssignments(environmentText: string, variableNames: readonly string[]): string {
  const variableNameSet: Set<string> = new Set<string>(variableNames);

  return environmentText
    .split('\n')
    .filter((line: string): boolean => !variableNameSet.has(line.split('=', 1)[0] ?? ''))
    .join('\n');
}

function replaceEnvironmentAssignment(environmentText: string, variableName: string, value: string): string {
  return environmentText
    .split('\n')
    .map((line: string): string => (line.startsWith(`${variableName}=`) ? `${variableName}=${value}` : line))
    .join('\n');
}

function renderEnvironmentAssignment(variableName: string, value: string): string {
  return `${variableName}=${value}`;
}
