import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type * as SelfHostedInstallPathsSourceModule from '../src/self-hosted-install-paths';
import type {
  DockerExecutionContext,
  PrepareSelfHostedRuntimeImagesInput,
  RestartSelfHostedRuntimeInput,
} from '../src/docker-runtime.types';
import type { CliBuildInfo } from '../src/cli-build-info.types';
import type { SelfHostedInstallState } from '../src/self-hosted-install-state.types';
import type { SelfHostedUpdateResult } from '../src/update.types';

type ReadCliBuildInfo = () => CliBuildInfo;
type EnsureDockerExecutionContext = () => Promise<DockerExecutionContext>;
type PrepareSelfHostedRuntimeImages = (
  context: DockerExecutionContext,
  input: PrepareSelfHostedRuntimeImagesInput,
) => Promise<void>;
type RestartSelfHostedRuntime = (
  context: DockerExecutionContext,
  input: RestartSelfHostedRuntimeInput,
) => Promise<void>;
type StageNodeAgentHostService = (input: object) => Promise<void>;
type RestartNodeAgentHostService = (input: object) => Promise<void>;
type WaitForNodeAgentHostServiceHealth = (input: object) => Promise<void>;
type AssertNodeAgentHostServiceInstallable = () => void;

interface DockerRuntimeModule {
  ensureDockerExecutionContext: Mock<EnsureDockerExecutionContext>;
  prepareSelfHostedRuntimeImages: Mock<PrepareSelfHostedRuntimeImages>;
  restartSelfHostedRuntime: Mock<RestartSelfHostedRuntime>;
}

interface CliBuildInfoModule {
  readCliBuildInfo: Mock<ReadCliBuildInfo>;
}

interface NodeAgentServiceModule {
  assertNodeAgentHostServiceInstallable: Mock<AssertNodeAgentHostServiceInstallable>;
  restartNodeAgentHostService: Mock<RestartNodeAgentHostService>;
  stageNodeAgentHostService: Mock<StageNodeAgentHostService>;
  waitForNodeAgentHostServiceHealth: Mock<WaitForNodeAgentHostServiceHealth>;
}

interface UpdateRuntimeMocks {
  ensureDockerExecutionContext: Mock<EnsureDockerExecutionContext>;
  prepareSelfHostedRuntimeImages: Mock<PrepareSelfHostedRuntimeImages>;
  restartNodeAgentHostService: Mock<RestartNodeAgentHostService>;
  restartSelfHostedRuntime: Mock<RestartSelfHostedRuntime>;
  stageNodeAgentHostService: Mock<StageNodeAgentHostService>;
  waitForNodeAgentHostServiceHealth: Mock<WaitForNodeAgentHostServiceHealth>;
  assertNodeAgentHostServiceInstallable: Mock<AssertNodeAgentHostServiceInstallable>;
}

interface TemporaryInstallPaths {
  configDir: string;
  dataDir: string;
}
const mocks: UpdateRuntimeMocks = vi.hoisted(
  (): UpdateRuntimeMocks => ({
    ensureDockerExecutionContext: vi.fn<EnsureDockerExecutionContext>(),
    prepareSelfHostedRuntimeImages: vi.fn<PrepareSelfHostedRuntimeImages>(),
    restartNodeAgentHostService: vi.fn<RestartNodeAgentHostService>(),
    restartSelfHostedRuntime: vi.fn<RestartSelfHostedRuntime>(),
    stageNodeAgentHostService: vi.fn<StageNodeAgentHostService>(),
    waitForNodeAgentHostServiceHealth: vi.fn<WaitForNodeAgentHostServiceHealth>(),
    assertNodeAgentHostServiceInstallable: vi.fn<AssertNodeAgentHostServiceInstallable>(),
  }),
);

describe.sequential('update runtime', (): void => {
  let temporaryDirectories: string[] = [];

  beforeEach((): void => {
    vi.resetModules();
    temporaryDirectories = [];
    mocks.ensureDockerExecutionContext.mockReset();
    mocks.prepareSelfHostedRuntimeImages.mockReset();
    mocks.restartNodeAgentHostService.mockReset();
    mocks.restartSelfHostedRuntime.mockReset();
    mocks.stageNodeAgentHostService.mockReset();
    mocks.waitForNodeAgentHostServiceHealth.mockReset();
    mocks.assertNodeAgentHostServiceInstallable.mockReset();
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
      }),
    );
    vi.doMock(
      '../src/node-agent-service',
      (): NodeAgentServiceModule => ({
        assertNodeAgentHostServiceInstallable: mocks.assertNodeAgentHostServiceInstallable,
        restartNodeAgentHostService: mocks.restartNodeAgentHostService.mockResolvedValue(undefined),
        stageNodeAgentHostService: mocks.stageNodeAgentHostService.mockResolvedValue(undefined),
        waitForNodeAgentHostServiceHealth: mocks.waitForNodeAgentHostServiceHealth.mockResolvedValue(undefined),
      }),
    );
  });

  afterEach(async (): Promise<void> => {
    vi.doUnmock('../src/cli-build-info');
    vi.doUnmock('../src/docker-runtime');
    vi.doUnmock('../src/node-agent-service');
    vi.doUnmock('../src/self-hosted-install-paths');
    await Promise.all(
      temporaryDirectories.map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
  });

  it('requires an existing install state before updating the runtime', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeCurrentInstallFiles(installPaths, createCurrentEnvironmentText());
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow(
      `Expected an existing self-hosted install state at ${join(installPaths.dataDir, 'self-hosted/install-state.json')}. Reinstall the runtime with \`compartment install\`.`,
    );
  });

  it('fails fast when the target directory does not contain a self-hosted environment', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow(
      `Expected an existing self-hosted install environment at ${join(installPaths.configDir, '.env.self-hosted')}`,
    );
  });

  it('updates a current install, preserves env values, and keeps installation metadata', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const previousEnvironmentText: string = createCurrentEnvironmentText({
      acmeCaUrl: 'https://acme.zerossl.com/v2/DV90',
      baseDomain: '4h8z9k2m1p7q.app.compartment.run',
      caddyTlsMode: 'managed',
      includeVariablesMasterKey: true,
      legacyAcmeDnsBrokerUrl: 'http://127.0.0.1:4545',
      legacyAcmeDnsToken: 'acme-token',
      logLevel: 'debug',
      nodeVersion: '0.1.0',
      publicIngressIpv4: '203.0.113.10',
      publicIngressIpv6: '2001:db8::10',
      publicProtocol: 'https',
      variablesMasterKey: 'a'.repeat(64),
    });
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeLegacyManagedDomainInstallState(installPaths);
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        imageSource: 'registry',
        version: '1.2.3',
      },
    });

    expect(result.status).toBe('updated');
    expect(result.currentVersion).toBe('0.1.0');
    expect(result.targetVersion).toBe('1.2.3');
    expect(result.imageSource).toBe('registry');
    expect(result.skipReason).toBeNull();
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_NODE_VERSION=1.2.3',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_RUNTIME_PROBE_IMAGE=docker.io/compartmentdev/compartment-runtime-probe:1.2.3',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_LOG_LEVEL=debug',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_DOCKER_NAMESPACE=compartment-test',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST=registry',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_PORT=5000',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_PUBLIC_PROTOCOL=https',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_PUBLIC_INGRESS_IPV4=203.0.113.10',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_PUBLIC_INGRESS_IPV6=2001:db8::10',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_CADDY_TLS_MODE=managed',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_ACME_CA_URL=https://acme.zerossl.com/v2/DV90',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL=http://127.0.0.1:4545',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=acme-token',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_ACME_EMAIL=admin@example.com',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.not.toContain(
      'COMPARTMENT_ACME_DNS_TOKEN=',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      `COMPARTMENT_DOCKER_WORK_DIR=${join(installPaths.dataDir, 'self-hosted/docker-work')}`,
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      `COMPARTMENT_VARIABLES_MASTER_KEY=${'a'.repeat(64)}`,
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_RUNTIME_CONTROL_TOKEN=runtime-token',
    );
    const backupDirectory: string = readRequiredBackupDirectory(result);
    await expect(readFile(join(backupDirectory, '.env.self-hosted'), 'utf8')).resolves.toBe(previousEnvironmentText);
    await expect(readMode(installPaths.configDir)).resolves.toBe(0o700);
    await expect(readMode(join(installPaths.configDir, '.env.self-hosted'))).resolves.toBe(0o600);
    await expect(readMode(backupDirectory)).resolves.toBe(0o700);
    await expect(readMode(join(backupDirectory, '.env.self-hosted'))).resolves.toBe(0o600);
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"imageSource": "registry"',
    );
    await expect(readMode(join(installPaths.dataDir, 'self-hosted'))).resolves.toBe(0o700);
    await expect(readMode(join(installPaths.dataDir, 'self-hosted/install-state.json'))).resolves.toBe(0o600);
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"installationId": "11111111-1111-4111-8111-111111111111"',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"brokerUrl": "http://127.0.0.1:4545"',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"managedDomainBrokerToken": "acme-token"',
    );
    expect(mocks.prepareSelfHostedRuntimeImages).toHaveBeenCalledTimes(1);
    expect(mocks.restartSelfHostedRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.prepareSelfHostedRuntimeImages.mock.calls[0]?.[1].imageSource).toBe('registry');
    expect(mocks.restartSelfHostedRuntime.mock.calls[0]?.[1].imageSource).toBe('registry');
    expect(mocks.prepareSelfHostedRuntimeImages.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.stageNodeAgentHostService.mock.invocationCallOrder[0]!,
    );
    expect(mocks.stageNodeAgentHostService.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.restartNodeAgentHostService.mock.invocationCallOrder[0]!,
    );
    expect(mocks.restartNodeAgentHostService.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.restartSelfHostedRuntime.mock.invocationCallOrder[0]!,
    );
    expect(mocks.restartSelfHostedRuntime.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.waitForNodeAgentHostServiceHealth.mock.invocationCallOrder[0]!,
    );
    expect(mocks.restartNodeAgentHostService).toHaveBeenCalledWith({
      envPath: join(installPaths.configDir, '.env.self-hosted'),
      waitForHealth: false,
    });
    expect(mocks.waitForNodeAgentHostServiceHealth).toHaveBeenCalledWith({
      envPath: join(installPaths.configDir, '.env.self-hosted'),
    });
  });

  it('leaves the current runtime files active when image preparation fails', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const previousEnvironmentText: string = createCurrentEnvironmentText({
      includeVariablesMasterKey: true,
      variablesMasterKey: 'c'.repeat(64),
    });
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const previousStateText: string = await readFile(
      join(installPaths.dataDir, 'self-hosted/install-state.json'),
      'utf8',
    );
    mocks.prepareSelfHostedRuntimeImages.mockRejectedValueOnce(new Error('signature failed'));
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          imageSource: 'registry',
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow('signature failed');

    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
    await expect(readFile(join(installPaths.configDir, 'docker-compose.self-hosted.yml'), 'utf8')).resolves.toBe(
      'services:\n',
    );
    await expect(readFile(join(installPaths.configDir, 'docker-compose.self-hosted.local.yml'), 'utf8')).resolves.toBe(
      'services:\n',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toBe(
      previousStateText,
    );
    await expect(stat(join(installPaths.dataDir, 'self-hosted/backups'))).rejects.toThrow();
    expect(mocks.stageNodeAgentHostService).not.toHaveBeenCalled();
    expect(mocks.restartNodeAgentHostService).not.toHaveBeenCalled();
    expect(mocks.restartSelfHostedRuntime).not.toHaveBeenCalled();
    expect(mocks.waitForNodeAgentHostServiceHealth).not.toHaveBeenCalled();
  });

  it('rejects registry update versions that do not match the packaged node agent binary', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeCurrentInstallFiles(installPaths, createCurrentEnvironmentText());
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          imageSource: 'registry',
          version: '9.9.9',
        },
      }),
    ).rejects.toThrow(
      'Host node-agent must come from the same packaged compartment CLI as the selected runtime version.',
    );

    expect(mocks.stageNodeAgentHostService).not.toHaveBeenCalled();
    expect(mocks.prepareSelfHostedRuntimeImages).not.toHaveBeenCalled();
  });

  it('rejects already-current registry update versions that do not match the packaged node agent binary', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeCurrentInstallFiles(installPaths, createCurrentEnvironmentText({ nodeVersion: '9.9.9' }));
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          imageSource: 'registry',
          version: '9.9.9',
        },
      }),
    ).rejects.toThrow(
      'Host node-agent must come from the same packaged compartment CLI as the selected runtime version.',
    );

    expect(mocks.stageNodeAgentHostService).not.toHaveBeenCalled();
    expect(mocks.prepareSelfHostedRuntimeImages).not.toHaveBeenCalled();
  });

  it('reuses the stored image source on a fresh-install state baseline', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const existingEnvironmentText: string = createCurrentEnvironmentText({
      includeVariablesMasterKey: true,
      variablesMasterKey: 'f'.repeat(64),
    });
    await writeCurrentInstallFiles(installPaths, existingEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'local',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        version: '1.2.3',
      },
    });

    expect(result.status).toBe('updated');
    expect(result.imageSource).toBe('local');
    expect(result.skipReason).toBeNull();
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      `COMPARTMENT_VARIABLES_MASTER_KEY=${'f'.repeat(64)}`,
    );
    expect(mocks.prepareSelfHostedRuntimeImages.mock.calls[0]?.[1].imageSource).toBe('local');
    expect(mocks.restartSelfHostedRuntime.mock.calls[0]?.[1].imageSource).toBe('local');
  });

  it('preserves activated custom HTTP domain runtime config during runtime updates', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeCurrentInstallFiles(
      installPaths,
      createCurrentEnvironmentText({
        baseDomain: 'customer.example.com',
        caddyTlsMode: 'custom-http',
        includeVariablesMasterKey: true,
        publicProtocol: 'https',
      }),
    );
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        version: '1.2.3',
      },
    });

    expect(result.status).toBe('updated');
    const updatedEnvironmentText: string = await readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_BASE_DOMAIN=customer.example.com');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_PUBLIC_PROTOCOL=https');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_CADDY_TLS_MODE=custom-http');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_ACME_CA_URL=');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_NODE_VERSION=1.2.3');
  });

  it('fails fast when the runtime control token is missing', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeCurrentInstallFiles(
      installPaths,
      createCurrentEnvironmentText({
        includeRuntimeControlToken: false,
        includeVariablesMasterKey: true,
      }),
    );
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow('The self-hosted environment is missing COMPARTMENT_RUNTIME_CONTROL_TOKEN.');
  });

  it('rejects installs missing required system token env', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const previousEnvironmentText: string = removeEnvironmentAssignments(createCurrentEnvironmentText(), [
      'COMPARTMENT_SYSTEM_TOKEN',
    ]);
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow('The self-hosted environment is missing COMPARTMENT_SYSTEM_TOKEN.');
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
    expect(mocks.prepareSelfHostedRuntimeImages).not.toHaveBeenCalled();
    expect(mocks.restartSelfHostedRuntime).not.toHaveBeenCalled();
  });

  it('migrates installs missing the host node-agent socket during runtime updates', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const previousEnvironmentText: string = removeEnvironmentAssignments(createCurrentEnvironmentText(), [
      'COMPARTMENT_NODE_AGENT_SOCKET',
    ]);
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });

    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        version: '1.2.3',
      },
    });

    expect(result.status).toBe('updated');
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/node/agent.sock',
    );
    await expect(readFile(join(readRequiredBackupDirectory(result), '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
  });

  it('applies an already-current update when host node-agent socket migration is required', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const previousEnvironmentText: string = removeEnvironmentAssignments(
      createCurrentEnvironmentText({
        nodeVersion: '1.2.3',
      }),
      ['COMPARTMENT_NODE_AGENT_SOCKET'],
    );
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });

    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        version: '1.2.3',
      },
    });

    expect(result.status).toBe('updated');
    expect(result.currentVersion).toBe('1.2.3');
    expect(result.targetVersion).toBe('1.2.3');
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/node/agent.sock',
    );
    await expect(readFile(join(readRequiredBackupDirectory(result), '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
  });

  it('migrates the legacy system API socket path while updating an environment', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const previousEnvironmentText: string = createCurrentEnvironmentText().replace(
      'COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/api/system-api.sock',
      'COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/system-api.sock',
    );
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });

    const { updateSelfHosted } = await import('../src/update');

    await updateSelfHosted({
      options: {
        version: '1.2.3',
      },
    });

    const nextEnvironmentText: string = await readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8');
    expect(nextEnvironmentText).toContain('COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/api/system-api.sock');
    expect(nextEnvironmentText).not.toContain('COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/system-api.sock');
    expect(mocks.prepareSelfHostedRuntimeImages).toHaveBeenCalledTimes(1);
    expect(mocks.restartSelfHostedRuntime).toHaveBeenCalledTimes(1);
  });

  it('rejects noncanonical host socket paths before updating an existing env', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const previousEnvironmentText: string = createCurrentEnvironmentText()
      .replace(
        'COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/node/agent.sock',
        'COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/custom-node/agent.sock',
      )
      .replace(
        'COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/api/system-api.sock',
        'COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/custom-api/system-api.sock',
      );
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });

    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow(
      'The self-hosted environment has unsupported COMPARTMENT_NODE_AGENT_SOCKET value /var/run/compartment/custom-node/agent.sock. Expected /var/run/compartment/node/agent.sock.',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
    expect(mocks.prepareSelfHostedRuntimeImages).not.toHaveBeenCalled();
    expect(mocks.restartSelfHostedRuntime).not.toHaveBeenCalled();
  });

  it('rejects install state without installationId instead of rewriting it', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const previousEnvironmentText: string = createCurrentEnvironmentText();
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeLegacyInstallStateWithoutInstallationId(installPaths);
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow('Invalid self-hosted install state');
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
    expect(mocks.prepareSelfHostedRuntimeImages).not.toHaveBeenCalled();
    expect(mocks.restartSelfHostedRuntime).not.toHaveBeenCalled();
  });

  it('restages compose assets even when a current install is missing staged compose files', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeCurrentInstallFiles(installPaths, createCurrentEnvironmentText());
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        imageSource: 'registry',
        version: '1.2.3',
      },
    });

    await expect(stat(join(installPaths.configDir, 'docker-compose.self-hosted.yml'))).resolves.toBeDefined();
    await expect(stat(join(installPaths.configDir, 'docker-compose.self-hosted.local.yml'))).resolves.toBeDefined();
    await expect(readFile(join(readRequiredBackupDirectory(result), '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_ENV=self-hosted',
    );
  });

  it('skips the update when the requested release version is not newer', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const previousEnvironmentText: string = createCurrentEnvironmentText({
      includeVariablesMasterKey: true,
      nodeVersion: '1.2.4',
    });
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        version: '1.2.3',
      },
    });

    expect(result).toEqual({
      backupDir: null,
      currentVersion: '1.2.4',
      imageSource: 'registry',
      ...installPaths,
      skipReason: 'downgrade-not-supported',
      status: 'skipped',
      targetVersion: '1.2.3',
    });
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
    expect(mocks.ensureDockerExecutionContext).not.toHaveBeenCalled();
    expect(mocks.prepareSelfHostedRuntimeImages).not.toHaveBeenCalled();
    expect(mocks.restartSelfHostedRuntime).not.toHaveBeenCalled();
  });

  it('reports downgrade-not-supported when a requested image-source switch also requires a downgrade', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const previousEnvironmentText: string = createCurrentEnvironmentText({
      includeVariablesMasterKey: true,
      nodeVersion: '1.2.4',
    });
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'local',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        imageSource: 'registry',
        version: '1.2.3',
      },
    });

    expect(result).toEqual({
      backupDir: null,
      currentVersion: '1.2.4',
      imageSource: 'registry',
      ...installPaths,
      skipReason: 'downgrade-not-supported',
      status: 'skipped',
      targetVersion: '1.2.3',
    });
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
    expect(mocks.ensureDockerExecutionContext).not.toHaveBeenCalled();
    expect(mocks.prepareSelfHostedRuntimeImages).not.toHaveBeenCalled();
    expect(mocks.restartSelfHostedRuntime).not.toHaveBeenCalled();
  });
});

async function createTemporaryInstallPaths(temporaryDirectories: string[]): Promise<TemporaryInstallPaths> {
  const temporaryDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-update-runtime-'));
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

function createCurrentEnvironmentText(
  options: {
    acmeCaUrl?: string | undefined;
    acmeEmail?: string | undefined;
    baseDomain?: string | undefined;
    caddyTlsMode?: string | undefined;
    includeVariablesMasterKey?: boolean | undefined;
    includeRuntimeControlToken?: boolean | undefined;
    legacyAcmeDnsBrokerUrl?: string | undefined;
    legacyAcmeDnsToken?: string | undefined;
    logLevel?: string | undefined;
    nodeVersion?: string | undefined;
    publicIngressIpv4?: string | undefined;
    publicIngressIpv6?: string | undefined;
    publicProtocol?: string | undefined;
    variablesMasterKey?: string | undefined;
  } = {},
): string {
  const values: string[] = [
    'COMPARTMENT_ENV=self-hosted',
    'COMPARTMENT_API_BIND_HOST=0.0.0.0',
    'COMPARTMENT_API_IMAGE=ghcr.io/compartmentdev/compartment-api:0.1.0',
    'COMPARTMENT_RUNTIME_PROBE_IMAGE=ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
    'COMPARTMENT_API_INTERNAL_HOST=api',
    'COMPARTMENT_API_PORT=39444',
    'COMPARTMENT_API_URL=http://127.0.0.1:39444',
    `COMPARTMENT_ACME_CA_URL=${options.acmeCaUrl ?? ''}`,
    `COMPARTMENT_ACME_DNS_BROKER_URL=${options.legacyAcmeDnsBrokerUrl ?? ''}`,
    `COMPARTMENT_ACME_DNS_TOKEN=${options.legacyAcmeDnsToken ?? ''}`,
    `COMPARTMENT_ACME_EMAIL=${options.acmeEmail ?? 'admin@example.com'}`,
    `COMPARTMENT_BASE_DOMAIN=${options.baseDomain ?? 'example.com'}`,
    `COMPARTMENT_CADDY_TLS_MODE=${options.caddyTlsMode ?? 'internal'}`,
    'COMPARTMENT_CUSTOM_TLS_CERT_FILE=/var/lib/compartment/self-hosted/custom-tls/fullchain.pem',
    'COMPARTMENT_CUSTOM_TLS_DIR=/var/lib/compartment/self-hosted/custom-tls',
    'COMPARTMENT_CUSTOM_TLS_KEY_FILE=/var/lib/compartment/self-hosted/custom-tls/privkey.pem',
    'COMPARTMENT_DATABASE_URL=postgresql://postgres:postgres@postgres:5432/compartment',
    'COMPARTMENT_DOCKER_NAMESPACE=compartment-test',
    'COMPARTMENT_DOCKER_WORK_DIR=/var/lib/compartment/self-hosted/docker-work',
    'COMPARTMENT_EDGE_BIND_HOST=0.0.0.0',
    'COMPARTMENT_EDGE_IMAGE=ghcr.io/compartmentdev/compartment-edge:0.1.0',
    'COMPARTMENT_EDGE_INTERNAL_HOST=edge',
    'COMPARTMENT_EDGE_PORT=39081',
    'COMPARTMENT_EDGE_TOKEN=edge-token',
    `COMPARTMENT_LOG_LEVEL=${options.logLevel ?? 'info'}`,
    `COMPARTMENT_PUBLIC_PROTOCOL=${options.publicProtocol ?? 'http'}`,
    'COMPARTMENT_NODE_APP_PORT_END=31999',
    'COMPARTMENT_NODE_APP_PORT_START=31000',
    'COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/node/agent.sock',
    'COMPARTMENT_NODE_NAME=self-hosted-node',
    `COMPARTMENT_NODE_VERSION=${options.nodeVersion ?? '0.1.0'}`,
    'COMPARTMENT_POSTGRES_DB=compartment',
    'COMPARTMENT_POSTGRES_PASSWORD=postgres',
    'COMPARTMENT_POSTGRES_USER=postgres',
    'COMPARTMENT_PUBLIC_HTTP_PORT=80',
    'COMPARTMENT_PUBLIC_HTTPS_PORT=443',
    `COMPARTMENT_PUBLIC_INGRESS_IPV4=${options.publicIngressIpv4 ?? ''}`,
    `COMPARTMENT_PUBLIC_INGRESS_IPV6=${options.publicIngressIpv6 ?? ''}`,
    'COMPARTMENT_CADDY_IMAGE=ghcr.io/compartmentdev/compartment-caddy:0.1.0',
    'COMPARTMENT_RUNTIME_CONNECTIVITY_MODE=network',
    'COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST=host.docker.internal',
    'COMPARTMENT_SESSION_SECRET=session-secret',
    'COMPARTMENT_SESSION_TTL=7d',
    'COMPARTMENT_SOURCE_ARCHIVE_DIR=/var/lib/compartment/source-archives',
    'COMPARTMENT_SOURCE_ARCHIVE_MAX_BYTES=104857600',
    'COMPARTMENT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/compartment_test',
    'COMPARTMENT_WORKER_POLL_INTERVAL_MS=1000',
    'COMPARTMENT_WORKER_IMAGE=ghcr.io/compartmentdev/compartment-worker:0.1.0',
  ];

  if (options.includeRuntimeControlToken !== false) {
    values.push('COMPARTMENT_RUNTIME_CONTROL_TOKEN=runtime-token');
  }
  if (options.includeVariablesMasterKey !== false) {
    values.push(`COMPARTMENT_VARIABLES_MASTER_KEY=${options.variablesMasterKey ?? 'a'.repeat(64)}`);
  }
  values.push('COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/api/system-api.sock');
  values.push('COMPARTMENT_SYSTEM_TOKEN=system-token');

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
  state: SelfHostedInstallState,
): Promise<void> {
  await mkdir(join(installPaths.dataDir, 'self-hosted'), { recursive: true });
  await writeFile(
    join(installPaths.dataDir, 'self-hosted/install-state.json'),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  );
}

async function writeLegacyInstallStateWithoutInstallationId(installPaths: TemporaryInstallPaths): Promise<void> {
  await mkdir(join(installPaths.dataDir, 'self-hosted'), { recursive: true });
  await writeFile(
    join(installPaths.dataDir, 'self-hosted/install-state.json'),
    `${JSON.stringify(
      {
        imageSource: 'registry',
        stateVersion: 1,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function writeLegacyManagedDomainInstallState(installPaths: TemporaryInstallPaths): Promise<void> {
  await mkdir(join(installPaths.dataDir, 'self-hosted'), { recursive: true });
  await writeFile(
    join(installPaths.dataDir, 'self-hosted/install-state.json'),
    `${JSON.stringify(
      {
        imageSource: 'registry',
        installationId: '11111111-1111-4111-8111-111111111111',
        managedDomain: {
          acmeDnsToken: 'acme-token',
          acmeEmail: 'admin@example.com',
          baseDomain: '4h8z9k2m1p7q.app.compartment.run',
          brokerUrl: 'http://127.0.0.1:4545',
        },
        stateVersion: 1,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function removeEnvironmentAssignments(environmentText: string, variableNames: readonly string[]): string {
  const variableNameSet: Set<string> = new Set<string>(variableNames);

  return environmentText
    .split('\n')
    .filter((line: string): boolean => !variableNameSet.has(line.split('=', 1)[0] ?? ''))
    .join('\n');
}

function readRequiredBackupDirectory(result: SelfHostedUpdateResult): string {
  if (result.backupDir !== null) {
    return result.backupDir;
  }

  throw new Error('Expected updateSelfHosted to create a backup directory.');
}

async function readMode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}
