import type { ClientRequest, IncomingMessage } from 'node:http';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import type { SelfHostedRuntimeServiceInspection } from '../src/docker-runtime.types';

type Chmod = (path: string, mode: number) => Promise<void>;
type Chown = (path: string, uid: number, gid: number) => Promise<void>;
type CopyFile = (sourcePath: string, destinationPath: string) => Promise<void>;
type Mkdir = (path: string, options: { mode?: number; recursive?: boolean }) => Promise<void>;
type ReadFile = (path: string, encoding: BufferEncoding) => Promise<string>;
type Rename = (oldPath: string, newPath: string) => Promise<void>;
type Rm = (path: string, options: { force: boolean }) => Promise<void>;
type RunCommand = (command: readonly string[]) => Promise<CommandResult>;
type WriteFile = (path: string, contents: string, options: { encoding: BufferEncoding; mode: number }) => Promise<void>;
type WriteFileCall = [path: string, contents: string, options: { encoding: BufferEncoding; mode: number }];
type IsSea = () => boolean;
type Lstat = (path: string) => Promise<MockStats>;
interface HttpRequestOptions {
  method?: string | undefined;
  path?: string | undefined;
  socketPath?: string | undefined;
}
type CreateHttpRequest = (options: HttpRequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
type RequestErrorListener = (error: Error) => void;
type ResponseEndListener = () => void;

type MockClientRequestShape = ClientRequest & {
  destroy: Mock<() => ClientRequest>;
  end: Mock<() => ClientRequest>;
  on: Mock<(event: string, listener: RequestErrorListener) => ClientRequest>;
  setTimeout: Mock<(timeoutMs: number, callback: () => void) => ClientRequest>;
};

interface MockIncomingMessageShape {
  on: (event: string, listener: ResponseEndListener) => IncomingMessage;
  resume: () => IncomingMessage;
  statusCode: number;
}

interface NodeAgentServiceTestMocks {
  chmod: Mock<Chmod>;
  chown: Mock<Chown>;
  copyFile: Mock<CopyFile>;
  createHttpRequest: Mock<CreateHttpRequest>;
  isSea: Mock<IsSea>;
  lstat: Mock<Lstat>;
  mkdir: Mock<Mkdir>;
  readFile: Mock<ReadFile>;
  rename: Mock<Rename>;
  rm: Mock<Rm>;
  runCommand: Mock<RunCommand>;
  writeFile: Mock<WriteFile>;
}

const mocks: NodeAgentServiceTestMocks = vi.hoisted(
  (): NodeAgentServiceTestMocks => ({
    chmod: vi.fn<Chmod>(),
    chown: vi.fn<Chown>(),
    copyFile: vi.fn<CopyFile>(),
    createHttpRequest: vi.fn<CreateHttpRequest>(),
    isSea: vi.fn<IsSea>(),
    lstat: vi.fn<Lstat>(),
    mkdir: vi.fn<Mkdir>(),
    readFile: vi.fn<ReadFile>(),
    rename: vi.fn<Rename>(),
    rm: vi.fn<Rm>(),
    runCommand: vi.fn<RunCommand>(),
    writeFile: vi.fn<WriteFile>(),
  }),
);

vi.mock('node:http', (): { request: Mock<CreateHttpRequest> } => ({
  request: mocks.createHttpRequest,
}));

vi.mock('node:sea', (): { isSea: Mock<IsSea> } => ({
  isSea: mocks.isSea,
}));

vi.mock(
  'node:fs/promises',
  (): {
    chmod: Mock<Chmod>;
    chown: Mock<Chown>;
    copyFile: Mock<CopyFile>;
    lstat: Mock<Lstat>;
    mkdir: Mock<Mkdir>;
    readFile: Mock<ReadFile>;
    rename: Mock<Rename>;
    rm: Mock<Rm>;
    writeFile: Mock<WriteFile>;
  } => ({
    chmod: mocks.chmod,
    chown: mocks.chown,
    copyFile: mocks.copyFile,
    lstat: mocks.lstat,
    mkdir: mocks.mkdir,
    readFile: mocks.readFile,
    rename: mocks.rename,
    rm: mocks.rm,
    writeFile: mocks.writeFile,
  }),
);

vi.mock(
  '../src/command-runner',
  (): {
    readCommandOutput: (result: CommandResult) => string;
    runCommand: Mock<RunCommand>;
  } => ({
    readCommandOutput: (result: CommandResult): string => (result.stderr.length > 0 ? result.stderr : result.stdout),
    runCommand: mocks.runCommand,
  }),
);

beforeEach((): void => {
  mocks.chmod.mockReset();
  mocks.chown.mockReset();
  mocks.copyFile.mockReset();
  mocks.createHttpRequest.mockReset();
  mocks.isSea.mockReset();
  mocks.isSea.mockReturnValue(true);
  mocks.lstat.mockReset();
  mocks.lstat.mockResolvedValue(createStats({ directory: true }));
  mocks.mkdir.mockReset();
  mocks.readFile.mockReset();
  mocks.rename.mockReset();
  mocks.rm.mockReset();
  mocks.runCommand.mockReset();
  mocks.writeFile.mockReset();
});

describe('node agent service staging', (): void => {
  it('stages the host service with hardened systemd settings and only node runtime ownership', async (): Promise<void> => {
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.copyFile.mockResolvedValue(undefined);
    mocks.chmod.mockResolvedValue(undefined);
    mocks.chown.mockResolvedValue(undefined);
    mocks.rename.mockResolvedValue(undefined);
    mocks.rm.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.runCommand.mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

    const { stageNodeAgentHostService } = await import('../src/node-agent-service');

    await stageNodeAgentHostService({ envPath: '/etc/compartment/.env.self-hosted' });

    const unitContents: string = readWrittenSystemdUnit();
    expect(unitContents).toContain('EnvironmentFile=/etc/compartment/.env.self-hosted');
    expect(unitContents).toContain('NoNewPrivileges=true');
    expect(unitContents).toContain('ProtectSystem=strict');
    expect(unitContents).toContain('RuntimeDirectory=compartment/node');
    expect(unitContents).not.toContain('compartment/api');
    expect(unitContents).toContain('RuntimeDirectoryMode=0700');
    expect(unitContents).toContain('RuntimeDirectoryPreserve=yes');
    const legacySelfHostedStateDirectory: string = ['compartment/on', 'prem'].join('');
    expect(unitContents).toContain(
      `StateDirectory=compartment/self-hosted ${legacySelfHostedStateDirectory} compartment/resource-backups`,
    );
    expect(unitContents).toContain('StateDirectoryMode=0700');
    expect(unitContents).toContain(
      `ReadWritePaths=/var/run/compartment/node /var/lib/compartment/self-hosted /var/lib/${legacySelfHostedStateDirectory} /var/lib/compartment/resource-backups /var/run/docker.sock`,
    );
    expect(unitContents).not.toContain('ExecStartPre=');
    const temporaryBinaryPath: string = readTemporaryBinaryPath();
    expect(mocks.copyFile).toHaveBeenCalledWith(process.execPath, temporaryBinaryPath);
    expect(mocks.chmod).toHaveBeenCalledWith(temporaryBinaryPath, 0o755);
    expect(mocks.rename).toHaveBeenCalledWith(temporaryBinaryPath, '/usr/local/bin/compartment-node-agent');
    expect(mocks.chmod).toHaveBeenCalledWith('/etc/systemd/system/compartment-node-agent.service', 0o644);
  });

  it('refuses symlink runtime directories before applying ownership or modes', async (): Promise<void> => {
    mocks.lstat.mockImplementation(async (path: string): Promise<MockStats> => {
      await Promise.resolve();
      if (path === '/var/run/compartment') {
        return createStats({ symlink: true });
      }

      return createStats({ directory: true });
    });
    const { stageNodeAgentHostService } = await import('../src/node-agent-service');

    await expect(stageNodeAgentHostService({ envPath: '/etc/compartment/.env.self-hosted' })).rejects.toThrow(
      'Compartment runtime directory /var/run/compartment must be a real directory.',
    );
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(mocks.chown).not.toHaveBeenCalled();
    expect(mocks.chmod).not.toHaveBeenCalled();
  });

  it('rejects staging from a non-self-contained Node entrypoint', async (): Promise<void> => {
    mocks.isSea.mockReturnValue(false);
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.copyFile.mockResolvedValue(undefined);
    mocks.chmod.mockResolvedValue(undefined);
    mocks.chown.mockResolvedValue(undefined);
    mocks.rename.mockResolvedValue(undefined);
    mocks.rm.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.runCommand.mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

    const { stageNodeAgentHostService } = await import('../src/node-agent-service');

    await expect(stageNodeAgentHostService({ envPath: '/etc/compartment/.env.self-hosted' })).rejects.toThrow(
      'compartment-node-agent can only be installed from the self-contained compartment binary.',
    );
    expect(mocks.copyFile).not.toHaveBeenCalled();
  });

  it('rejects host node-agent installability from a non-self-contained Node entrypoint', async (): Promise<void> => {
    mocks.isSea.mockReturnValue(false);
    const { assertNodeAgentHostServiceInstallable } = await import('../src/node-agent-service');

    expect((): void => assertNodeAgentHostServiceInstallable()).toThrow(
      'compartment-node-agent can only be installed from the self-contained compartment binary.',
    );
  });
});

describe('node agent service inspection', (): void => {
  it('reads host service health through the configured Unix socket', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: 'active\n' });
    mockNodeAgentHealthStatus(200);
    const { inspectNodeAgentHostService } = await import('../src/node-agent-service');

    const result: SelfHostedRuntimeServiceInspection = await inspectNodeAgentHostService({
      nodeSocketPath: '/var/run/compartment/node/agent.sock',
    });

    expect(result).toEqual({
      containerId: null,
      health: 'healthy',
      imageRef: null,
      name: 'node',
      publishedPorts: [],
      startedAt: null,
      status: 'running',
    });
    expect(mocks.createHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/healthz',
        socketPath: '/var/run/compartment/node/agent.sock',
      }),
      expect.any(Function),
    );
  });

  it('reports unhealthy when the host service socket health check fails', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: 'active\n' });
    mockNodeAgentHealthError();
    const { inspectNodeAgentHostService } = await import('../src/node-agent-service');

    const result: SelfHostedRuntimeServiceInspection = await inspectNodeAgentHostService({
      nodeSocketPath: '/var/run/compartment/node/agent.sock',
    });

    expect(result.health).toBe('unhealthy');
    expect(result.status).toBe('running');
  });

  it('reports unhealthy when the host service socket health check times out', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: 'active\n' });
    const request: MockClientRequestShape = mockNodeAgentHealthTimeout();
    const { inspectNodeAgentHostService } = await import('../src/node-agent-service');

    const result: SelfHostedRuntimeServiceInspection = await inspectNodeAgentHostService({
      nodeSocketPath: '/var/run/compartment/node/agent.sock',
    });

    expect(result.health).toBe('unhealthy');
    expect(result.status).toBe('running');
    expect(request.destroy).toHaveBeenCalled();
  });
});

describe('node agent service restart', (): void => {
  it('fails when the host service cannot be restarted', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValueOnce({ exitCode: 1, stderr: 'not found', stdout: '' });
    const { restartNodeAgentHostService } = await import('../src/node-agent-service');

    await expect(restartNodeAgentHostService({ envPath: '/etc/compartment/.env.self-hosted' })).rejects.toThrow(
      'Failed to restart compartment-node-agent service.\nnot found',
    );

    expect(mocks.runCommand).toHaveBeenCalledTimes(1);
    expect(mocks.runCommand).toHaveBeenCalledWith(['systemctl', 'restart', 'compartment-node-agent.service']);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.createHttpRequest).not.toHaveBeenCalled();
  });

  it('restarts an installed host service and waits for socket health', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '' });
    mocks.readFile.mockResolvedValueOnce('COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/node/agent.sock\n');
    mockNodeAgentHealthStatus(200);
    const { restartNodeAgentHostService } = await import('../src/node-agent-service');

    await restartNodeAgentHostService({ envPath: '/etc/compartment/.env.self-hosted' });

    expect(mocks.runCommand).toHaveBeenNthCalledWith(1, ['systemctl', 'restart', 'compartment-node-agent.service']);
    expect(mocks.createHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/healthz',
        socketPath: '/var/run/compartment/node/agent.sock',
      }),
      expect.any(Function),
    );
  });

  it('can restart the host service without waiting for socket health', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '' });
    const { restartNodeAgentHostService } = await import('../src/node-agent-service');

    await restartNodeAgentHostService({
      envPath: '/etc/compartment/.env.self-hosted',
      waitForHealth: false,
    });

    expect(mocks.runCommand).toHaveBeenNthCalledWith(1, ['systemctl', 'restart', 'compartment-node-agent.service']);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.createHttpRequest).not.toHaveBeenCalled();
  });

  it('rejects noncanonical restart health sockets from the env file', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '' });
    mocks.readFile.mockResolvedValueOnce('COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/custom-node/agent.sock\n');
    const { restartNodeAgentHostService } = await import('../src/node-agent-service');

    await expect(restartNodeAgentHostService({ envPath: '/etc/compartment/.env.self-hosted' })).rejects.toThrow(
      'The self-hosted environment has unsupported COMPARTMENT_NODE_AGENT_SOCKET value /var/run/compartment/custom-node/agent.sock. Expected /var/run/compartment/node/agent.sock.',
    );
    expect(mocks.createHttpRequest).not.toHaveBeenCalled();
  });
});

function readTemporaryBinaryPath(): string {
  const copyFileCall: [sourcePath: string, destinationPath: string] | undefined = mocks.copyFile.mock.calls[0];
  if (copyFileCall === undefined) {
    throw new Error('Expected node agent binary to be copied.');
  }

  return copyFileCall[1];
}

function readWrittenSystemdUnit(): string {
  const unitWriteCall: WriteFileCall | undefined = mocks.writeFile.mock.calls.find(
    ([path]: WriteFileCall): boolean => path === '/etc/systemd/system/compartment-node-agent.service',
  );
  if (unitWriteCall === undefined) {
    throw new Error('Expected node agent systemd unit to be written.');
  }

  return unitWriteCall[1];
}

function mockNodeAgentHealthStatus(statusCode: number): void {
  mocks.createHttpRequest.mockImplementationOnce(
    (_options: HttpRequestOptions, callback: (response: IncomingMessage) => void): ClientRequest => {
      const response: MockIncomingMessageShape = {
        statusCode,
        resume: vi.fn((): IncomingMessage => response as IncomingMessage),
        on: vi.fn((event: string, listener: () => void): IncomingMessage => {
          if (event === 'end') {
            listener();
          }

          return response as IncomingMessage;
        }),
      };
      callback(response as IncomingMessage);
      return createMockClientRequest();
    },
  );
}

function mockNodeAgentHealthError(): void {
  mocks.createHttpRequest.mockImplementationOnce((): ClientRequest => createMockClientRequest({ triggerError: true }));
}

function mockNodeAgentHealthTimeout(): MockClientRequestShape {
  const request: MockClientRequestShape = createMockClientRequest({ triggerTimeout: true });
  mocks.createHttpRequest.mockImplementationOnce((): ClientRequest => request);
  return request;
}

function createMockClientRequest(
  input: { triggerError?: boolean | undefined; triggerTimeout?: boolean | undefined } = {},
): MockClientRequestShape {
  const request: MockClientRequestShape = {
    destroy: vi.fn((): ClientRequest => request as ClientRequest),
    end: vi.fn((): ClientRequest => request as ClientRequest),
    on: vi.fn((event: string, listener: (error: Error) => void): ClientRequest => {
      if (input.triggerError === true && event === 'error') {
        listener(new Error('socket unavailable'));
      }

      return request;
    }),
    setTimeout: vi.fn((_timeoutMs: number, callback: () => void): ClientRequest => {
      if (input.triggerTimeout === true) {
        callback();
      }

      return request;
    }),
  } as MockClientRequestShape;
  return request;
}

function createStats(input: { directory?: boolean | undefined; symlink?: boolean | undefined }): MockStats {
  return new MockStats(input);
}

class MockStats {
  private readonly directory: boolean;
  private readonly symlink: boolean;

  public constructor(input: { directory?: boolean | undefined; symlink?: boolean | undefined }) {
    this.directory = input.directory === true;
    this.symlink = input.symlink === true;
  }

  public isDirectory(): boolean {
    return this.directory;
  }

  public isSymbolicLink(): boolean {
    return this.symlink;
  }
}
