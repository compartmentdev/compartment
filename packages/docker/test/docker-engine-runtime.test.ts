import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createDockerEngineContainer,
  inspectDockerEngineContainer,
  readDockerEngineContainerLogs,
  removeDockerEngineContainer,
} from '../src/docker-engine-runtime';
import { renameDockerEngineContainer } from '../src/docker-engine-runtime-rename';
import { runDockerContainerToCompletion } from '../src/docker-runtime';
import type { DockerContainerSecurityProfile, DockerRunContainerToCompletionResult } from '../src/docker-models';

type CreateDockerClient = () => Promise<MockDockerClient>;
type HasText = (value: string | null | undefined) => value is string;
type DockerContainerInspect = () => Promise<MockDockerInspectInfo>;
type DockerContainerLogs = (options: MockDockerLogsOptions) => Promise<Buffer>;
type DockerContainerRename = (options: MockDockerRenameOptions) => Promise<void>;
type DockerContainerRemove = (options: MockDockerRemoveOptions) => Promise<void>;
type DockerContainerStart = () => Promise<void>;
type DockerContainerStop = () => Promise<void>;
type DockerContainerWait = () => Promise<MockDockerWaitResult>;
type DockerCreateContainer = (options: MockDockerContainerCreateOptions) => Promise<MockDockerContainer>;
type DockerCreateNetwork = (options: MockDockerCreateNetworkOptions) => Promise<MockDockerNetwork>;
type DockerCreateVolume = (options: MockDockerCreateVolumeOptions) => Promise<MockDockerVolume>;
type DockerGetContainer = (containerRef: string) => MockDockerContainer;

interface DockerEngineRuntimeTestMocks {
  createDockerClient: Mock<CreateDockerClient>;
}

interface MockDockerClient {
  createContainer: Mock<DockerCreateContainer>;
  createNetwork: Mock<DockerCreateNetwork>;
  createVolume: Mock<DockerCreateVolume>;
  getContainer: Mock<DockerGetContainer>;
}

interface MockDockerContainer {
  id: string;
  inspect: Mock<DockerContainerInspect>;
  logs: Mock<DockerContainerLogs>;
  rename: Mock<DockerContainerRename>;
  remove: Mock<DockerContainerRemove>;
  start: Mock<DockerContainerStart>;
  stop: Mock<DockerContainerStop>;
  wait: Mock<DockerContainerWait>;
}

interface MockDockerContainerCreateOptions {
  Cmd?: string[] | undefined;
  Entrypoint?: string[] | undefined;
  Env?: string[] | undefined;
  ExposedPorts?: MockDockerExposedPortMap | undefined;
  HostConfig?: MockDockerHostConfig | undefined;
  Image?: string | undefined;
  Labels?: Record<string, string> | undefined;
  NetworkingConfig?: MockDockerNetworkingConfig | undefined;
  Tty?: boolean | undefined;
  name?: string | undefined;
}

type MockDockerExposedPortValue = Record<string, never>;
type MockDockerExposedPortMap = Record<string, MockDockerExposedPortValue>;

interface MockDockerHostConfig {
  Binds?: string[] | undefined;
  CapAdd?: string[] | undefined;
  CapDrop?: string[] | undefined;
  ExtraHosts?: string[] | undefined;
  Mounts?: MockDockerMount[] | undefined;
  NetworkMode?: string | undefined;
  PortBindings?: MockDockerPortMap | undefined;
  ReadonlyRootfs?: boolean | undefined;
  RestartPolicy?: MockDockerRestartPolicy | undefined;
  SecurityOpt?: string[] | undefined;
}

interface MockDockerMount {
  Source: string;
  Target: string;
  Type: 'volume';
}

interface MockDockerNetworkingConfig {
  EndpointsConfig: Record<string, MockDockerNetworkingEndpoint>;
}

interface MockDockerNetworkingEndpoint {
  Aliases?: string[] | undefined;
}

interface MockDockerInspectConfig {
  Image: string;
  Labels?: Record<string, string> | null | undefined;
}

interface MockDockerInspectInfo {
  Config: MockDockerInspectConfig;
  Id: string;
  NetworkSettings: MockDockerInspectNetworkSettings;
  State?: MockDockerInspectState | undefined;
}

interface MockDockerInspectNetworkSettings {
  Networks?: Record<string, MockDockerEndpointSettings> | null | undefined;
  Ports?: MockDockerPortBindings | null | undefined;
}

interface MockDockerEndpointSettings {
  Aliases?: string[] | undefined;
  IPAddress?: string | undefined;
}

interface MockDockerInspectState {
  Running?: boolean | undefined;
}

interface MockDockerLogsOptions {
  follow?: false | undefined;
  stderr: true;
  stdout: true;
  tail?: number | undefined;
  timestamps: boolean;
}

interface MockDockerPortBinding {
  HostIp?: string | undefined;
  HostPort?: string | undefined;
}

type MockDockerPortBindings = Record<string, MockDockerPortBinding[] | null | undefined>;
type MockDockerPortMap = Record<string, MockDockerPortBinding[]>;

interface MockDockerRestartPolicy {
  MaximumRetryCount?: number | undefined;
  Name?: string | undefined;
}

interface MockDockerRemoveOptions {
  force?: boolean | undefined;
}

interface MockDockerRenameOptions {
  name: string;
}

interface MockDockerCreateVolumeOptions {
  Labels?: Record<string, string> | undefined;
  Name: string;
}

interface MockDockerCreateNetworkOptions {
  Attachable: true;
  CheckDuplicate: true;
  Driver: 'bridge';
  Name: string;
}

interface MockDockerWaitResult {
  StatusCode: number;
}

interface MockDockerNetwork {
  id: string;
}

interface MockDockerVolume {
  name: string;
}

const mocks: DockerEngineRuntimeTestMocks = vi.hoisted(
  (): DockerEngineRuntimeTestMocks => ({
    createDockerClient: vi.fn<CreateDockerClient>(),
  }),
);
const restrictedWritableSecurityProfile: DockerContainerSecurityProfile = {
  name: 'restricted-writable',
  writableRootFilesystemReason: 'test runtime writes',
};
const restrictedWritableWithCapabilityAdditionsSecurityProfile: DockerContainerSecurityProfile = {
  capabilityAdditions: {
    add: ['CHOWN', 'NET_BIND_SERVICE', 'SETGID', 'SETUID'],
    reason: 'test image entrypoint compatibility',
  },
  name: 'restricted-writable',
  writableRootFilesystemReason: 'test runtime writes',
};

vi.mock('../src/docker-client', (): { createDockerClient: Mock<CreateDockerClient>; hasText: HasText } => ({
  createDockerClient: mocks.createDockerClient,
  hasText: (value: string | null | undefined): value is string => typeof value === 'string' && value !== '',
}));

afterEach((): void => {
  mocks.createDockerClient.mockReset();
});

describe('createDockerEngineContainer', (): void => {
  it('creates and starts a runtime container with published ports and env', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({ id: 'container_123' });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      createDockerEngineContainer({
        containerName: 'compartment-smoke-web-production-web',
        env: { PORT: '3000', NODE_ENV: 'production' },
        imageRef: 'sha256:image-id',
        labels: {
          'compartment.deploymentId': 'dep_123',
          'compartment.environment': 'production',
        },
        publishedPorts: [
          {
            containerPort: 3000,
            hostPort: 31000,
          },
        ],
        restartPolicy: {
          name: 'on-failure',
        },
        securityProfile: restrictedWritableSecurityProfile,
      }),
    ).resolves.toEqual({ containerId: 'container_123' });

    expect(dockerClient.createContainer).toHaveBeenCalledWith({
      Env: ['PORT=3000', 'NODE_ENV=production'],
      ExposedPorts: {
        '3000/tcp': {},
      },
      HostConfig: {
        CapDrop: ['ALL'],
        Mounts: undefined,
        PortBindings: {
          '3000/tcp': [
            {
              HostIp: '0.0.0.0',
              HostPort: '31000',
            },
          ],
        },
        RestartPolicy: {
          Name: 'on-failure',
        },
        ReadonlyRootfs: false,
        SecurityOpt: ['no-new-privileges:true'],
      },
      Image: 'sha256:image-id',
      Labels: {
        'compartment.deploymentId': 'dep_123',
        'compartment.environment': 'production',
      },
      NetworkingConfig: undefined,
      Tty: false,
      name: 'compartment-smoke-web-production-web',
    });
    expect(container.start).toHaveBeenCalledTimes(1);
  });

  it('adds only explicitly requested capabilities after dropping all defaults', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({ id: 'container_124' });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await createDockerEngineContainer({
      containerName: 'compartment-smoke-web-production-web',
      env: {},
      imageRef: 'sha256:image-id',
      labels: {},
      securityProfile: restrictedWritableWithCapabilityAdditionsSecurityProfile,
    });

    const createOptions: MockDockerContainerCreateOptions | undefined = dockerClient.createContainer.mock.calls[0]?.[0];
    expect(createOptions?.HostConfig?.CapDrop).toEqual(['ALL']);
    expect(createOptions?.HostConfig?.CapAdd).toEqual(['CHOWN', 'NET_BIND_SERVICE', 'SETGID', 'SETUID']);
    expect(createOptions?.HostConfig?.SecurityOpt).toEqual(['no-new-privileges:true']);
  });

  it('passes a runtime command override as the docker cmd when provided', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({ id: 'container_789' });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      createDockerEngineContainer({
        command: ['npm run start:override'],
        containerName: 'compartment-smoke-web-production-web',
        env: { PORT: '3000' },
        imageRef: 'sha256:image-id',
        labels: {
          'compartment.deploymentId': 'dep_456',
        },
        securityProfile: restrictedWritableSecurityProfile,
      }),
    ).resolves.toEqual({ containerId: 'container_789' });

    const createOptions: MockDockerContainerCreateOptions | undefined = dockerClient.createContainer.mock.calls[0]?.[0];
    expect(createOptions?.Cmd).toEqual(['npm run start:override']);
  });

  it('passes an entrypoint override separately from the docker cmd when provided', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({ id: 'container_791' });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      createDockerEngineContainer({
        command: ['pnpm db:migrate'],
        containerName: 'compartment-smoke-web-production-web-release',
        entrypoint: ['sh', '-lc'],
        env: { PORT: '3000' },
        imageRef: 'sha256:image-id',
        labels: {
          'compartment.deploymentId': 'dep_456',
        },
        securityProfile: restrictedWritableSecurityProfile,
      }),
    ).resolves.toEqual({ containerId: 'container_791' });

    const createOptions: MockDockerContainerCreateOptions | undefined = dockerClient.createContainer.mock.calls[0]?.[0];
    expect(createOptions?.Entrypoint).toEqual(['sh', '-lc']);
    expect(createOptions?.Cmd).toEqual(['pnpm db:migrate']);
  });

  it('passes restart policy retry limits through to docker host config', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({ id: 'container_790' });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await createDockerEngineContainer({
      containerName: 'compartment-smoke-web-production-web',
      env: { PORT: '3000' },
      imageRef: 'sha256:image-id',
      labels: {
        'compartment.deploymentId': 'dep_456',
      },
      restartPolicy: {
        maximumRetryCount: 5,
        name: 'on-failure',
      },
      securityProfile: restrictedWritableSecurityProfile,
    });

    const createOptions: MockDockerContainerCreateOptions | undefined = dockerClient.createContainer.mock.calls[0]?.[0];
    expect(createOptions?.HostConfig?.RestartPolicy).toEqual({
      MaximumRetryCount: 5,
      Name: 'on-failure',
    });
  });

  it('supports bridge networking, extra hosts, and bind mounts', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({ id: 'container_456' });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await createDockerEngineContainer({
      containerName: 'compartment-caddy',
      env: {},
      extraHosts: [
        {
          host: 'host.docker.internal',
          target: 'host-gateway',
        },
      ],
      imageRef: 'caddy:2.10',
      labels: {
        'compartment.component': 'caddy',
      },
      mounts: [
        {
          containerPath: '/etc/caddy/Caddyfile',
          hostPath: '/tmp/compartment/Caddyfile',
          readOnly: true,
        },
        {
          containerPath: '/data',
          hostPath: '/tmp/compartment/data',
        },
      ],
      network: 'bridge',
      securityProfile: restrictedWritableSecurityProfile,
    });

    expect(dockerClient.createContainer).toHaveBeenCalledWith({
      Env: [],
      ExposedPorts: undefined,
      HostConfig: {
        Binds: ['/tmp/compartment/Caddyfile:/etc/caddy/Caddyfile:ro', '/tmp/compartment/data:/data'],
        CapDrop: ['ALL'],
        ExtraHosts: ['host.docker.internal:host-gateway'],
        Mounts: undefined,
        NetworkMode: 'bridge',
        PortBindings: undefined,
        ReadonlyRootfs: false,
        SecurityOpt: ['no-new-privileges:true'],
      },
      Image: 'caddy:2.10',
      Labels: {
        'compartment.component': 'caddy',
      },
      NetworkingConfig: undefined,
      Tty: false,
      name: 'compartment-caddy',
    });
  });

  it('passes named network aliases through docker networking config', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({ id: 'container_999' });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await createDockerEngineContainer({
      containerName: 'compartment-runtime',
      env: { PORT: '3000' },
      imageRef: 'sha256:image-id',
      labels: {
        'compartment.deploymentId': 'dep_789',
      },
      network: {
        aliases: ['compartment-runtime-upstream'],
        name: 'compartment-runtime-internal',
      },
      securityProfile: restrictedWritableSecurityProfile,
    });

    expect(dockerClient.createContainer).toHaveBeenCalledWith({
      Env: ['PORT=3000'],
      ExposedPorts: undefined,
      HostConfig: {
        CapDrop: ['ALL'],
        Mounts: undefined,
        NetworkMode: 'compartment-runtime-internal',
        PortBindings: undefined,
        ReadonlyRootfs: false,
        SecurityOpt: ['no-new-privileges:true'],
      },
      Image: 'sha256:image-id',
      Labels: {
        'compartment.deploymentId': 'dep_789',
      },
      NetworkingConfig: {
        EndpointsConfig: {
          'compartment-runtime-internal': {
            Aliases: ['compartment-runtime-upstream'],
          },
        },
      },
      Tty: false,
      name: 'compartment-runtime',
    });
  });
});

describe('removeDockerEngineContainer', (): void => {
  it('swallows missing container errors', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({ id: 'compartment-missing' });
    container.remove.mockRejectedValueOnce(new Error('No such container: compartment-missing'));
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(removeDockerEngineContainer({ containerRef: 'compartment-missing' })).resolves.toBeUndefined();
    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });

  it('rethrows non-missing remove errors', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({ id: 'compartment-busy' });
    container.remove.mockRejectedValueOnce(new Error('docker daemon unavailable'));
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(removeDockerEngineContainer({ containerRef: 'compartment-busy' })).rejects.toThrow(
      'docker daemon unavailable',
    );
    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });
});

describe('renameDockerEngineContainer', (): void => {
  it('swallows missing container errors', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({ id: 'resource_container_123' });
    container.rename.mockRejectedValueOnce(new Error('No such container: resource_container_123'));
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      renameDockerEngineContainer({
        containerRef: 'resource_container_123',
        nextContainerName: 'compartment-resource-previous',
      }),
    ).resolves.toBeUndefined();
  });

  it('rethrows non-missing rename errors', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({ id: 'resource_container_123' });
    container.rename.mockRejectedValueOnce(new Error('rename conflict'));
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      renameDockerEngineContainer({
        containerRef: 'resource_container_123',
        nextContainerName: 'compartment-resource-previous',
      }),
    ).rejects.toThrow('rename conflict');
  });
});

describe('inspectDockerEngineContainer', (): void => {
  it('returns parsed container metadata and published ports', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({
      id: 'container_123',
      inspectResult: {
        Config: {
          Image: 'sha256:image-id',
          Labels: {
            'compartment.deploymentId': 'dep_123',
            'compartment.routeHost': 'smoke-web.localhost',
          },
        },
        Id: 'container_123',
        NetworkSettings: {
          Ports: {
            '3000/tcp': [
              {
                HostIp: '127.0.0.1',
                HostPort: '31000',
              },
            ],
          },
        },
        State: {
          Running: true,
        },
      },
    });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      inspectDockerEngineContainer({ containerRef: 'compartment-smoke-web-production-web' }),
    ).resolves.toEqual({
      containerId: 'container_123',
      imageRef: 'sha256:image-id',
      isRunning: true,
      labels: {
        'compartment.deploymentId': 'dep_123',
        'compartment.routeHost': 'smoke-web.localhost',
      },
      publishedPorts: [
        {
          containerPort: 3000,
          hostIp: '127.0.0.1',
          hostPort: 31000,
        },
      ],
    });
  });

  it('returns attached network aliases from docker inspect', async (): Promise<void> => {
    const containerIpAddress: string = buildIpv4Address([10, 240, 0, 2]);
    const container: MockDockerContainer = createMockDockerContainer({
      id: 'container_123',
      inspectResult: {
        Config: {
          Image: 'sha256:image-id',
          Labels: {},
        },
        Id: 'container_123',
        NetworkSettings: {
          Networks: {
            'compartment-runtime': {
              Aliases: ['upstream-dep-123', 'resource.internal'],
              IPAddress: containerIpAddress,
            },
          },
          Ports: {},
        },
        State: {
          Running: true,
        },
      },
    });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(inspectDockerEngineContainer({ containerRef: 'container_123' })).resolves.toEqual({
      containerId: 'container_123',
      imageRef: 'sha256:image-id',
      isRunning: true,
      labels: {},
      networkAttachments: [
        {
          aliases: ['upstream-dep-123', 'resource.internal'],
          ipAddress: containerIpAddress,
          name: 'compartment-runtime',
        },
      ],
      publishedPorts: [],
    });
  });

  it('returns null when the container is missing', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({ id: 'compartment-missing' });
    container.inspect.mockRejectedValueOnce({
      message: 'Error: No such object: compartment-missing',
      statusCode: 404,
    });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(inspectDockerEngineContainer({ containerRef: 'compartment-missing' })).resolves.toBeNull();
  });

  it('falls back to empty labels when docker inspect returns null labels', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({
      id: 'container_456',
      inspectResult: {
        Config: {
          Image: 'sha256:image-id',
          Labels: null,
        },
        Id: 'container_456',
        NetworkSettings: {
          Ports: {},
        },
        State: {
          Running: true,
        },
      },
    });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(inspectDockerEngineContainer({ containerRef: 'container_456' })).resolves.toEqual({
      containerId: 'container_456',
      imageRef: 'sha256:image-id',
      isRunning: true,
      labels: {},
      publishedPorts: [],
    });
  });

  it('returns the docker running state with the container metadata', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({
      id: 'container_789',
      inspectResult: {
        Config: {
          Image: 'sha256:image-id',
          Labels: {},
        },
        Id: 'container_789',
        NetworkSettings: {
          Ports: {},
        },
        State: {
          Running: false,
        },
      },
    });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(inspectDockerEngineContainer({ containerRef: 'container_789' })).resolves.toEqual({
      containerId: 'container_789',
      imageRef: 'sha256:image-id',
      isRunning: false,
      labels: {},
      publishedPorts: [],
    });
  });
});

describe('readDockerEngineContainerLogs', (): void => {
  it('returns parsed docker log lines from the engine client', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({
      id: 'container_123',
      logsBuffer: Buffer.concat([
        createDockerLogFrame('stdout', '2026-03-23T12:00:00.000000000Z boot complete\n'),
        createDockerLogFrame('stderr', '2026-03-23T12:00:01.000000000Z traceback line\n'),
      ]),
    });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      readDockerEngineContainerLogs({
        containerId: 'container_123',
        since: '2026-03-23T12:00:00.900Z',
        tailLines: 50,
      }),
    ).resolves.toEqual([
      {
        message: 'boot complete',
        stream: 'stdout',
        timestamp: '2026-03-23T12:00:00.000000000Z',
      },
      {
        message: 'traceback line',
        stream: 'stderr',
        timestamp: '2026-03-23T12:00:01.000000000Z',
      },
    ]);

    expect(container.logs).toHaveBeenCalledWith({
      follow: false,
      since: 1774267200,
      stderr: true,
      stdout: true,
      tail: 50,
      timestamps: true,
    });
  });

  it('omits the docker tail option when the caller does not request a tail limit', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({
      id: 'container_123',
      logsBuffer: Buffer.alloc(0),
    });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      readDockerEngineContainerLogs({
        containerId: 'container_123',
        since: '2026-03-23T12:00:00.900Z',
      }),
    ).resolves.toEqual([]);

    expect(container.logs).toHaveBeenCalledWith({
      follow: false,
      since: 1774267200,
      stderr: true,
      stdout: true,
      timestamps: true,
    });
  });

  it('returns no log lines when the container is removed before the log read', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({
      id: 'container_123',
    });
    container.logs.mockRejectedValueOnce({
      json: {
        message: 'No such container: container_123',
      },
      statusCode: 404,
    });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      readDockerEngineContainerLogs({
        containerId: 'container_123',
        tailLines: 50,
      }),
    ).resolves.toEqual([]);
  });

  it('runs operation containers to completion with ordered multiword output', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({
      id: 'container_123',
      logsBuffer: Buffer.concat([
        createDockerLogFrame('stdout', 'migrating records\n'),
        createDockerLogFrame('stderr', 'warning line\n'),
      ]),
    });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValue(dockerClient);

    const result: DockerRunContainerToCompletionResult = await runDockerContainerToCompletion({
      command: ['sh', '-lc', 'pnpm db:migrate'],
      containerName: 'release-container',
      env: {},
      imageRef: 'sha256:image',
      labels: {},
      securityProfile: restrictedWritableSecurityProfile,
    });

    expect(result).toEqual({
      containerId: 'container_123',
      logs: [
        { message: 'migrating records', stream: 'stdout', timestamp: null },
        { message: 'warning line', stream: 'stderr', timestamp: null },
      ],
      stderr: 'warning line',
      stdout: 'migrating records',
    });
    expect(container.logs).toHaveBeenCalledWith({
      stderr: true,
      stdout: true,
      timestamps: false,
    });
    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });

  it('stops timed-out operation containers and preserves available logs on the thrown error', async (): Promise<void> => {
    const container: MockDockerContainer = createMockDockerContainer({
      id: 'container_123',
      logsBuffer: Buffer.concat([
        createDockerLogFrame('stdout', 'migrating records\n'),
        createDockerLogFrame('stderr', 'waiting on lock\n'),
      ]),
    });
    container.wait.mockImplementationOnce(async (): Promise<MockDockerWaitResult> => {
      return await new Promise<MockDockerWaitResult>((): void => undefined);
    });
    const dockerClient: MockDockerClient = createMockDockerClient({
      createdContainer: container,
      inspectedContainer: container,
    });
    mocks.createDockerClient.mockResolvedValue(dockerClient);

    await expect(
      runDockerContainerToCompletion({
        command: ['sh', '-lc', 'pnpm db:migrate'],
        containerName: 'release-container',
        env: {},
        imageRef: 'sha256:image',
        labels: {},
        securityProfile: restrictedWritableSecurityProfile,
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({
      logs: [
        { message: 'migrating records', stream: 'stdout', timestamp: null },
        { message: 'waiting on lock', stream: 'stderr', timestamp: null },
      ],
      stderr: 'waiting on lock',
      stdout: 'migrating records',
    });
    expect(container.stop).toHaveBeenCalledWith({ t: 1 });
    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });
});

interface MockDockerClientInput {
  createdContainer: MockDockerContainer;
  inspectedContainer: MockDockerContainer;
}

interface MockDockerContainerInput {
  id: string;
  inspectResult?: MockDockerInspectInfo | undefined;
  logsBuffer?: Buffer | undefined;
}

function createMockDockerClient(input: MockDockerClientInput): MockDockerClient {
  return {
    createContainer: vi.fn<DockerCreateContainer>().mockResolvedValue(input.createdContainer),
    createNetwork: vi.fn<DockerCreateNetwork>().mockResolvedValue({ id: 'network_123' }),
    createVolume: vi.fn<DockerCreateVolume>().mockResolvedValue({ name: 'mock-volume' }),
    getContainer: vi.fn<DockerGetContainer>().mockReturnValue(input.inspectedContainer),
  };
}

function createMockDockerContainer(input: MockDockerContainerInput): MockDockerContainer {
  return {
    id: input.id,
    inspect: vi
      .fn<DockerContainerInspect>()
      .mockResolvedValue(input.inspectResult ?? createMockDockerInspectInfo(input.id)),
    logs: vi.fn<DockerContainerLogs>().mockResolvedValue(input.logsBuffer ?? Buffer.alloc(0)),
    rename: vi.fn<DockerContainerRename>().mockResolvedValue(undefined),
    remove: vi.fn<DockerContainerRemove>().mockResolvedValue(undefined),
    start: vi.fn<DockerContainerStart>().mockResolvedValue(undefined),
    stop: vi.fn<DockerContainerStop>().mockResolvedValue(undefined),
    wait: vi.fn<DockerContainerWait>().mockResolvedValue({ StatusCode: 0 }),
  };
}

function createMockDockerInspectInfo(containerId: string): MockDockerInspectInfo {
  return {
    Config: {
      Image: 'sha256:image-id',
      Labels: {},
    },
    Id: containerId,
    NetworkSettings: {
      Ports: {},
    },
    State: {
      Running: true,
    },
  };
}

function createDockerLogFrame(stream: 'stdout' | 'stderr', text: string): Buffer {
  const payload: Buffer = Buffer.from(text, 'utf8');
  const header: Buffer = Buffer.alloc(8);

  header[0] = stream === 'stdout' ? 1 : 2;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function buildIpv4Address(octets: readonly [number, number, number, number]): string {
  return octets.map((octet: number): string => octet.toString()).join('.');
}
