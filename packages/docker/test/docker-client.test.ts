import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createDockerClient } from '../src/docker-client';
import type { DockerCommandResult } from '../src/docker-command.types';

type RunDockerCommand = (args: string[]) => Promise<DockerCommandResult>;
type DockerFactory = () => MockDockerClient;

interface DockerClientTestMocks {
  createdClients: MockDockerClient[];
  dockerConstructor: Mock<DockerFactory>;
  runDockerCommand: Mock<RunDockerCommand>;
}

interface MockDockerClient {
  dockerCertPath: string | undefined;
  dockerHost: string | undefined;
  dockerTlsVerify: string | undefined;
}

const originalDockerHost: string | undefined = process.env.DOCKER_HOST;
const originalDockerCertPath: string | undefined = process.env.DOCKER_CERT_PATH;
const originalDockerTlsVerify: string | undefined = process.env.DOCKER_TLS_VERIFY;

const mocks: DockerClientTestMocks = vi.hoisted(
  (): DockerClientTestMocks => ({
    createdClients: [],
    dockerConstructor: vi.fn<DockerFactory>((): MockDockerClient => {
      const client: MockDockerClient = {
        dockerCertPath: process.env.DOCKER_CERT_PATH,
        dockerHost: process.env.DOCKER_HOST,
        dockerTlsVerify: process.env.DOCKER_TLS_VERIFY,
      };
      mocks.createdClients.push(client);
      return client;
    }),
    runDockerCommand: vi.fn<RunDockerCommand>(),
  }),
);

vi.mock('dockerode', (): { default: Mock<DockerFactory> } => ({
  default: mocks.dockerConstructor,
}));

vi.mock('../src/docker-command', (): { runDockerCommand: Mock<RunDockerCommand> } => ({
  runDockerCommand: mocks.runDockerCommand,
}));

afterEach((): void => {
  if (originalDockerHost === undefined) {
    delete process.env.DOCKER_HOST;
  } else {
    process.env.DOCKER_HOST = originalDockerHost;
  }

  if (originalDockerCertPath === undefined) {
    delete process.env.DOCKER_CERT_PATH;
  } else {
    process.env.DOCKER_CERT_PATH = originalDockerCertPath;
  }

  if (originalDockerTlsVerify === undefined) {
    delete process.env.DOCKER_TLS_VERIFY;
  } else {
    process.env.DOCKER_TLS_VERIFY = originalDockerTlsVerify;
  }

  mocks.createdClients.length = 0;
  mocks.dockerConstructor.mockClear();
  mocks.runDockerCommand.mockReset();
});

describe('createDockerClient', (): void => {
  it('uses the current docker context local socket and clears inherited TLS env', async (): Promise<void> => {
    delete process.env.DOCKER_HOST;
    process.env.DOCKER_CERT_PATH = '/Users/test/inherited/certs';
    process.env.DOCKER_TLS_VERIFY = '1';
    mocks.runDockerCommand.mockResolvedValueOnce({
      stderr: '',
      stdout: JSON.stringify({
        Endpoints: {
          docker: {
            Host: 'unix:///Users/test/.docker/run/docker.sock',
          },
        },
      }),
    });

    await createDockerClient();
    const client: MockDockerClient = readCreatedDockerClient();

    expect(mocks.runDockerCommand).toHaveBeenCalledWith(['context', 'inspect', '--format', '{{ json . }}']);
    expect(mocks.dockerConstructor).toHaveBeenCalledWith();
    expect(client).toEqual({
      dockerCertPath: undefined,
      dockerHost: 'unix:///Users/test/.docker/run/docker.sock',
      dockerTlsVerify: undefined,
    });
    expect(process.env.DOCKER_HOST).toBeUndefined();
    expect(process.env.DOCKER_CERT_PATH).toBe('/Users/test/inherited/certs');
    expect(process.env.DOCKER_TLS_VERIFY).toBe('1');
  });

  it('prefers local-socket DOCKER_HOST over docker context inspection', async (): Promise<void> => {
    process.env.DOCKER_HOST = 'unix:///var/run/docker.sock';
    process.env.DOCKER_CERT_PATH = '/Users/test/inherited/certs';
    process.env.DOCKER_TLS_VERIFY = '1';

    await createDockerClient();
    const client: MockDockerClient = readCreatedDockerClient();

    expect(mocks.runDockerCommand).not.toHaveBeenCalled();
    expect(mocks.dockerConstructor).toHaveBeenCalledWith();
    expect(client).toEqual({
      dockerCertPath: undefined,
      dockerHost: 'unix:///var/run/docker.sock',
      dockerTlsVerify: undefined,
    });
    expect(process.env.DOCKER_HOST).toBe('unix:///var/run/docker.sock');
    expect(process.env.DOCKER_CERT_PATH).toBe('/Users/test/inherited/certs');
    expect(process.env.DOCKER_TLS_VERIFY).toBe('1');
  });

  it('rejects remote DOCKER_HOST values', async (): Promise<void> => {
    process.env.DOCKER_HOST = 'tcp://127.0.0.1:2375';

    await expect(createDockerClient()).rejects.toThrow(
      'Unsupported Docker host "tcp://127.0.0.1:2375" from DOCKER_HOST. Compartment requires a local Docker socket on the same machine.',
    );
    expect(mocks.runDockerCommand).not.toHaveBeenCalled();
    expect(mocks.dockerConstructor).not.toHaveBeenCalled();
  });

  it('rejects remote docker context hosts', async (): Promise<void> => {
    delete process.env.DOCKER_HOST;
    delete process.env.DOCKER_CERT_PATH;
    delete process.env.DOCKER_TLS_VERIFY;
    mocks.runDockerCommand.mockResolvedValueOnce({
      stderr: '',
      stdout: JSON.stringify({
        Endpoints: {
          docker: {
            Host: 'tcp://docker.example.internal:2376',
          },
        },
      }),
    });

    await expect(createDockerClient()).rejects.toThrow(
      'Unsupported Docker host "tcp://docker.example.internal:2376" from docker context. Compartment requires a local Docker socket on the same machine.',
    );
    expect(mocks.dockerConstructor).not.toHaveBeenCalled();
  });
});

function readCreatedDockerClient(): MockDockerClient {
  const result: MockDockerClient | undefined = mocks.createdClients[0];
  if (result === undefined) {
    throw new Error('Expected Docker client construction to return a mock client.');
  }

  return result;
}
