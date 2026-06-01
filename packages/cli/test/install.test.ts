import { createServer, type Server } from 'node:net';
import type * as DockerRuntimeSourceModule from '../src/docker-runtime';
import type * as InstallServiceSourceModule from '../src/services/install.service';
import type * as NodeAgentServiceSourceModule from '../src/node-agent-service';
import type * as SelfHostedInstallPathsSourceModule from '../src/self-hosted-install-paths';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { findFreePort } from '@compartment/test-support';
import type { DockerExecutionContext, EnsureDockerExecutionContextOptions } from '../src/docker-runtime.types';
import type {
  SelfHostedInstallInput,
  SelfHostedInstallPreflightInput,
  SelfHostedInstallResult,
} from '../src/install.types';
import type { InstallInput } from '../src/services/install.service.types';
import { findDistinctFreePorts, findFreePortExcluding, type DistinctFreePorts } from './public-port-test-support';

type EnsureDockerExecutionContext = (options?: EnsureDockerExecutionContextOptions) => Promise<DockerExecutionContext>;
type InstallAgainstApiResult = Omit<SelfHostedInstallResult, 'apiUrl' | 'configDir' | 'dataDir'>;
type InstallAgainstApi = (context: { apiUrl: string }, input: InstallInput) => Promise<InstallAgainstApiResult>;
type PrepareSelfHostedRuntimeImages = (context: DockerExecutionContext, input: object) => Promise<void>;
type StartSelfHostedRuntime = (context: DockerExecutionContext, input: object) => Promise<void>;
type StageNodeAgentHostService = (input: object) => Promise<void>;
type RestartNodeAgentHostService = (input: object) => Promise<void>;
type AssertNodeAgentHostServiceInstallable = () => void;

interface DockerRuntimeModule {
  ensureDockerExecutionContext: Mock<EnsureDockerExecutionContext>;
  prepareSelfHostedRuntimeImages: Mock<PrepareSelfHostedRuntimeImages>;
  startSelfHostedRuntime: Mock<StartSelfHostedRuntime>;
}

interface InstallServiceModule {
  install: Mock<InstallAgainstApi>;
}

interface NodeAgentServiceModule {
  assertNodeAgentHostServiceInstallable: Mock<AssertNodeAgentHostServiceInstallable>;
  restartNodeAgentHostService: Mock<RestartNodeAgentHostService>;
  stageNodeAgentHostService: Mock<StageNodeAgentHostService>;
}

interface MockInstallRuntimeOptions {
  installResult?: InstallAgainstApiResult;
}

interface TemporaryInstallPaths {
  configDir: string;
  dataDir: string;
}

describe.sequential('install runtime', (): void => {
  let temporaryDirectories: string[] = [];
  let occupiedServers: Server[] = [];

  beforeEach((): void => {
    vi.resetModules();
    temporaryDirectories = [];
    occupiedServers = [];
  });

  afterEach(async (): Promise<void> => {
    vi.doUnmock('../src/docker-runtime');
    vi.doUnmock('../src/node-agent-service');
    vi.doUnmock('../src/self-hosted-install-paths');
    vi.doUnmock('../src/services/install.service');

    await Promise.all([
      ...temporaryDirectories.map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
      ...occupiedServers.map(closeServer),
    ]);
  });

  it('preflights install prerequisites without writing staged runtime files', async (): Promise<void> => {
    mockInstallRuntime();
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const { preflightSelfHostedInstall } = await import('../src/install');
    const [publicHttpPort, publicHttpsPort]: DistinctFreePorts = await findDistinctFreePorts();

    const input: SelfHostedInstallPreflightInput = {
      options: { imageRegistry: 'github', imageSource: 'registry', publicHttpPort, publicHttpsPort, version: '1.2.3' },
    };

    await expect(preflightSelfHostedInstall(input)).resolves.toBeUndefined();
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(installPaths.configDir, 'docker-compose.self-hosted.yml'), 'utf8')).rejects.toThrow();
  });

  it('fails default system install before runtime writes when not running as root', async (): Promise<void> => {
    mockInstallRuntime();
    const processWithGetuid: NodeJS.Process & { getuid: () => number } = process as NodeJS.Process & {
      getuid: () => number;
    };
    vi.spyOn(processWithGetuid, 'getuid').mockReturnValue(501);
    const { installSelfHosted } = await import('../src/install');
    const dockerRuntimeModule: typeof DockerRuntimeSourceModule = await import('../src/docker-runtime');

    await expect(
      installSelfHosted({
        options: {
          adminEmail: 'admin@example.com',
          adminPassword: 'supersecretpassword',
          baseDomain: 'example.com',
          imageRegistry: 'github',
          imageSource: 'registry',
          installationId: '11111111-1111-4111-8111-111111111111',
          organizationName: 'Acme Dev',
          publicHttpPort: 80,
          publicHttpsPort: 443,
          publicIngressIpv4: '',
          publicIngressIpv6: '',
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow('System self-hosted commands use /etc/compartment and /var/lib/compartment.');
    expect(vi.mocked(dockerRuntimeModule.ensureDockerExecutionContext)).not.toHaveBeenCalled();
  });

  it('fails preflight on an occupied public HTTP port before validating browser hosts', async (): Promise<void> => {
    mockInstallRuntime();
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const busyHttpPort: number = await findFreePort();
    const publicHttpsPort: number = await findFreePortExcluding([busyHttpPort]);
    occupiedServers.push(await occupyPort(busyHttpPort));
    const { preflightSelfHostedInstall } = await import('../src/install');

    await expect(
      preflightSelfHostedInstall({
        options: {
          imageRegistry: 'github',
          imageSource: 'registry',
          publicHttpPort: busyHttpPort,
          publicHttpsPort,
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow(
      `Public HTTP port ${busyHttpPort} is already in use on this host. Choose a different --public-http-port.`,
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(installPaths.configDir, 'docker-compose.self-hosted.yml'), 'utf8')).rejects.toThrow();
  });

  it('preflights managed-domain installs before broker allocation provides a base domain', async (): Promise<void> => {
    mockInstallRuntime();
    await createTemporaryInstallPaths(temporaryDirectories);
    const { preflightSelfHostedInstall } = await import('../src/install');
    const [publicHttpPort, publicHttpsPort]: DistinctFreePorts = await findDistinctFreePorts();

    await expect(
      preflightSelfHostedInstall({
        options: {
          imageRegistry: 'github',
          imageSource: 'registry',
          publicHttpPort,
          publicHttpsPort,
          version: '1.2.3',
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('stages the packaged self-hosted install environment and reports progress', async (): Promise<void> => {
    mockInstallRuntime();
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const { installSelfHosted } = await import('../src/install');
    const progressMessages: string[] = [];

    const input: SelfHostedInstallInput = {
      context: {
        reportProgress: (message: string): void => {
          progressMessages.push(message);
        },
      },
      options: {
        adminEmail: 'admin@example.com',
        adminPassword: 'supersecretpassword',
        baseDomain: 'example.com',
        imageRegistry: 'github',
        imageSource: 'registry',
        installationId: '11111111-1111-4111-8111-111111111111',
        organizationName: 'Acme Dev',
        publicHttpPort: 8080,
        publicHttpsPort: 8443,
        publicIngressIpv4: '',
        publicIngressIpv6: '',
        version: '1.2.3',
      },
    };

    await expect(installSelfHosted(input)).resolves.toMatchObject({
      apiUrl: 'http://127.0.0.1:39444',
      baseDomain: 'example.com',
      configDir: installPaths.configDir,
      dataDir: installPaths.dataDir,
      operation: {
        type: 'compartment.install',
      },
      organization: {
        slug: 'acme-dev',
      },
    });
    expect(progressMessages).toEqual([
      'Preparing self-hosted install environment...',
      'Preparing runtime images...',
      'Staging self-hosted runtime assets...',
      'Staging node agent service...',
      'Starting self-hosted runtime...',
      'Restarting node agent service...',
      'Installing compartment...',
    ]);
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_PUBLIC_HTTP_PORT=8080',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_PUBLIC_HTTPS_PORT=8443',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_PUBLIC_INGRESS_IPV4=',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_PUBLIC_INGRESS_IPV6=',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_API_IMAGE=ghcr.io/compartmentdev/compartment-api:1.2.3',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_RUNTIME_PROBE_IMAGE=ghcr.io/compartmentdev/compartment-runtime-probe:1.2.3',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'BUILDKIT_ADDR=unix:///run/buildkit/buildkitd.sock',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_RUNTIME_UID=10001',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_RUNTIME_GID=10001',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_VARIABLES_MASTER_KEY=',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_CADDY_TLS_MODE=internal',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      `COMPARTMENT_DOCKER_WORK_DIR=${join(installPaths.dataDir, 'self-hosted/docker-work')}`,
    );
    await expect(readMode(installPaths.configDir)).resolves.toBe(0o700);
    await expect(readMode(join(installPaths.configDir, '.env.self-hosted'))).resolves.toBe(0o600);
    await expect(readFile(join(installPaths.configDir, 'docker-compose.self-hosted.yml'), 'utf8')).resolves.toContain(
      'services:',
    );
    await expect(readFile(join(installPaths.configDir, 'docker-compose.self-hosted.yml'), 'utf8')).resolves.toContain(
      'compartment-caddy-data:/data',
    );
    await expect(readFile(join(installPaths.configDir, 'docker-compose.self-hosted.yml'), 'utf8')).resolves.toContain(
      'COMPARTMENT_EDGE_INTERNAL_HOST: ${COMPARTMENT_EDGE_INTERNAL_HOST}',
    );
    await expect(readFile(join(installPaths.configDir, 'docker-compose.self-hosted.yml'), 'utf8')).resolves.toContain(
      "user: '${COMPARTMENT_RUNTIME_UID}:${COMPARTMENT_RUNTIME_GID}'",
    );
    await expect(
      readFile(join(installPaths.configDir, 'docker-compose.self-hosted.local.yml'), 'utf8'),
    ).resolves.toContain('pull_policy: never');
    await expect(stat(join(installPaths.dataDir, 'self-hosted/docker-work'))).resolves.toBeDefined();
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"imageRegistry": "github"',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"imageSource": "registry"',
    );
    await expect(readMode(join(installPaths.dataDir, 'self-hosted'))).resolves.toBe(0o700);
    await expect(readMode(join(installPaths.dataDir, 'self-hosted/install-state.json'))).resolves.toBe(0o600);
  });

  it('stages Docker Hub image refs and persists the registry selection when requested', async (): Promise<void> => {
    mockInstallRuntime();
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const { installSelfHosted } = await import('../src/install');

    await expect(
      installSelfHosted({
        options: {
          adminEmail: 'admin@example.com',
          adminPassword: 'supersecretpassword',
          baseDomain: 'example.com',
          imageRegistry: 'docker-hub',
          imageSource: 'registry',
          installationId: '11111111-1111-4111-8111-111111111111',
          organizationName: 'Acme Dev',
          publicHttpPort: 8080,
          publicHttpsPort: 8443,
          publicIngressIpv4: '',
          publicIngressIpv6: '',
          version: '1.2.3',
        },
      }),
    ).resolves.toMatchObject({
      configDir: installPaths.configDir,
      dataDir: installPaths.dataDir,
    });
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_API_IMAGE=docker.io/compartmentdev/compartment-api:1.2.3',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_RUNTIME_PROBE_IMAGE=docker.io/compartmentdev/compartment-runtime-probe:1.2.3',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"imageRegistry": "docker-hub"',
    );
  });

  it('leaves the install directory retryable when runtime image preparation fails', async (): Promise<void> => {
    mockInstallRuntime();
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const { installSelfHosted } = await import('../src/install');
    const dockerRuntimeModule: typeof DockerRuntimeSourceModule = await import('../src/docker-runtime');
    const installServiceModule: typeof InstallServiceSourceModule = await import('../src/services/install.service');
    const nodeAgentServiceModule: typeof NodeAgentServiceSourceModule = await import('../src/node-agent-service');
    vi.mocked(dockerRuntimeModule.prepareSelfHostedRuntimeImages).mockRejectedValueOnce(new Error('signature failed'));

    await expect(
      installSelfHosted({
        options: {
          adminEmail: 'admin@example.com',
          adminPassword: 'supersecretpassword',
          baseDomain: 'example.com',
          imageRegistry: 'github',
          imageSource: 'registry',
          installationId: '11111111-1111-4111-8111-111111111111',
          organizationName: 'Acme Dev',
          publicHttpPort: 8080,
          publicHttpsPort: 8443,
          publicIngressIpv4: '',
          publicIngressIpv6: '',
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow('signature failed');

    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(installPaths.configDir, 'docker-compose.self-hosted.yml'), 'utf8')).rejects.toThrow();
    await expect(
      readFile(join(installPaths.configDir, 'docker-compose.self-hosted.local.yml'), 'utf8'),
    ).rejects.toThrow();
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).rejects.toThrow();
    expect(vi.mocked(nodeAgentServiceModule.stageNodeAgentHostService)).not.toHaveBeenCalled();
    expect(vi.mocked(nodeAgentServiceModule.restartNodeAgentHostService)).not.toHaveBeenCalled();
    expect(vi.mocked(dockerRuntimeModule.startSelfHostedRuntime)).not.toHaveBeenCalled();
    expect(vi.mocked(installServiceModule.install)).not.toHaveBeenCalled();
  });

  it('does not write runtime files into the current directory', async (): Promise<void> => {
    mockInstallRuntime();
    await createTemporaryInstallPaths(temporaryDirectories);
    const workingDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-install-cwd-'));
    temporaryDirectories.push(workingDirectory);
    const previousWorkingDirectory: string = process.cwd();
    const { installSelfHosted } = await import('../src/install');

    try {
      process.chdir(workingDirectory);
      await installSelfHosted({
        options: {
          adminEmail: 'admin@example.com',
          adminPassword: 'supersecretpassword',
          baseDomain: '127.0.0.1.sslip.io',
          imageRegistry: 'github',
          imageSource: 'registry',
          installationId: '11111111-1111-4111-8111-111111111111',
          organizationName: 'Acme Dev',
          publicHttpPort: 8080,
          publicHttpsPort: 8443,
          publicIngressIpv4: '',
          publicIngressIpv6: '',
          version: '1.2.3',
        },
      });
    } finally {
      process.chdir(previousWorkingDirectory);
    }

    await expect(stat(join(workingDirectory, '.env.self-hosted'))).rejects.toThrow();
    await expect(stat(join(workingDirectory, 'docker-compose.self-hosted.yml'))).rejects.toThrow();
    await expect(stat(join(workingDirectory, '.compartment'))).rejects.toThrow();
  });

  it('uses the selected image tag in the staged environment when local images are requested', async (): Promise<void> => {
    mockInstallRuntime();
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const { installSelfHosted } = await import('../src/install');

    await expect(
      installSelfHosted({
        options: {
          adminEmail: 'admin@example.com',
          adminPassword: 'supersecretpassword',
          baseDomain: 'example.com',
          imageRegistry: 'github',
          imageSource: 'local',
          installationId: '11111111-1111-4111-8111-111111111111',
          organizationName: 'Acme Dev',
          publicHttpPort: 80,
          publicHttpsPort: 443,
          publicIngressIpv4: '',
          publicIngressIpv6: '',
          version: 'main',
        },
      }),
    ).resolves.toMatchObject({
      configDir: installPaths.configDir,
      dataDir: installPaths.dataDir,
      organization: {
        slug: 'acme-dev',
      },
    });
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_API_IMAGE=ghcr.io/compartmentdev/compartment-api:main',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_RUNTIME_PROBE_IMAGE=ghcr.io/compartmentdev/compartment-runtime-probe:main',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_NODE_VERSION=main',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"imageRegistry": "github"',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"imageSource": "local"',
    );
  });

  it('persists managed domain metadata in the self-hosted install state', async (): Promise<void> => {
    mockInstallRuntime();
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const { installSelfHosted } = await import('../src/install');

    await expect(
      installSelfHosted({
        options: {
          adminEmail: 'admin@example.com',
          adminPassword: 'supersecretpassword',
          baseDomain: '4h8z9k2m1p7q.app.compartment.run',
          imageRegistry: 'github',
          imageSource: 'registry',
          installationId: '11111111-1111-4111-8111-111111111111',
          managedDomain: {
            acmeEmail: 'admin@example.com',
            baseDomain: '4h8z9k2m1p7q.app.compartment.run',
            brokerUrl: 'http://127.0.0.1:4545',
            managedDomainBrokerToken: 'broker-token',
          },
          organizationName: 'Acme Dev',
          publicHttpPort: 80,
          publicHttpsPort: 443,
          publicIngressIpv4: '203.0.113.10',
          publicIngressIpv6: '2001:db8::10',
          version: '1.2.3',
        },
      }),
    ).resolves.toMatchObject({
      baseDomain: '4h8z9k2m1p7q.app.compartment.run',
      configDir: installPaths.configDir,
      dataDir: installPaths.dataDir,
    });
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"installationId": "11111111-1111-4111-8111-111111111111"',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"brokerUrl": "http://127.0.0.1:4545"',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"managedDomainBrokerToken": "broker-token"',
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
      'COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=broker-token',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_ACME_EMAIL=admin@example.com',
    );
  });

  it('refuses to re-use an install directory that already contains a self-hosted environment', async (): Promise<void> => {
    mockInstallRuntime();
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    const envPath: string = join(installPaths.configDir, '.env.self-hosted');
    const existingEnvironmentText: string = 'COMPARTMENT_SESSION_SECRET=existing-session-secret\n';
    await mkdir(installPaths.configDir, { recursive: true });
    await writeFile(envPath, existingEnvironmentText, 'utf8');
    const { installSelfHosted } = await import('../src/install');

    await expect(
      installSelfHosted({
        options: {
          adminEmail: 'admin@example.com',
          adminPassword: 'supersecretpassword',
          baseDomain: 'example.com',
          imageRegistry: 'github',
          imageSource: 'registry',
          installationId: '11111111-1111-4111-8111-111111111111',
          organizationName: 'Acme Dev',
          publicHttpPort: 80,
          publicHttpsPort: 443,
          publicIngressIpv4: '',
          publicIngressIpv6: '',
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow(
      `Refusing to re-run install for an existing self-hosted config directory at ${installPaths.configDir} because ${envPath} already exists. Remove the existing installation explicitly before retrying.`,
    );
    await expect(readFile(envPath, 'utf8')).resolves.toBe(existingEnvironmentText);
  });
});

function mockInstallRuntime(options: MockInstallRuntimeOptions = {}): void {
  vi.doMock(
    '../src/docker-runtime',
    (): DockerRuntimeModule => ({
      ensureDockerExecutionContext: vi.fn<EnsureDockerExecutionContext>().mockResolvedValue({
        dockerCommand: ['docker'],
        isRootlessDocker: false,
        mode: 'direct',
      }),
      prepareSelfHostedRuntimeImages: vi.fn<PrepareSelfHostedRuntimeImages>().mockResolvedValue(undefined),
      startSelfHostedRuntime: vi.fn<StartSelfHostedRuntime>().mockResolvedValue(undefined),
    }),
  );
  vi.doMock(
    '../src/services/install.service',
    (): InstallServiceModule => ({
      install: vi
        .fn<InstallAgainstApi>()
        .mockImplementation(
          async (_context: { apiUrl: string }, input: InstallInput): Promise<InstallAgainstApiResult> =>
            await Promise.resolve(options.installResult ?? createInstallResult(input.baseDomain)),
        ),
    }),
  );
  vi.doMock(
    '../src/node-agent-service',
    (): NodeAgentServiceModule => ({
      assertNodeAgentHostServiceInstallable: vi.fn<AssertNodeAgentHostServiceInstallable>(),
      restartNodeAgentHostService: vi.fn<RestartNodeAgentHostService>().mockResolvedValue(undefined),
      stageNodeAgentHostService: vi.fn<StageNodeAgentHostService>().mockResolvedValue(undefined),
    }),
  );
}

function createInstallResult(baseDomain: string = 'example.com'): InstallAgainstApiResult {
  return {
    adminEmail: 'admin@example.com',
    baseDomain,
    dnsRecords: [],
    operation: {
      completedAt: '2026-04-01T00:00:00.000Z',
      createdAt: '2026-04-01T00:00:00.000Z',
      id: 'op_123',
      status: 'succeeded',
      targetId: 'org_123',
      targetType: 'organization',
      type: 'compartment.install',
    },
    organization: {
      id: 'org_123',
      name: 'Acme Dev',
      slug: 'acme-dev',
    },
    compartmentUrl: 'http://console.example.com',
    sessionToken: 'session_123',
  };
}

async function createTemporaryInstallPaths(temporaryDirectories: string[]): Promise<TemporaryInstallPaths> {
  const rootDir: string = await mkdtemp(join(tmpdir(), 'compartment-install-'));
  temporaryDirectories.push(rootDir);
  const installPaths: TemporaryInstallPaths = {
    configDir: join(rootDir, 'etc'),
    dataDir: join(rootDir, 'var'),
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

async function occupyPort(port: number): Promise<Server> {
  return await new Promise<Server>((resolve: (server: Server) => void, reject: (error: Error) => void): void => {
    const server: Server = createServer();
    server.once('error', reject);
    server.listen(port, '0.0.0.0', (): void => {
      resolve(server);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
    server.close((error?: Error): void => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function readMode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}
