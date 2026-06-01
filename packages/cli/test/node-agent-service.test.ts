import type { ClientRequest, IncomingMessage } from 'node:http';
import type { Dirent } from 'node:fs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import type { SelfHostedRuntimeServiceInspection } from '../src/docker-runtime.types';

type Chmod = (path: string, mode: number) => Promise<void>;
type Chown = (path: string, uid: number, gid: number) => Promise<void>;
type CopyFile = (sourcePath: string, destinationPath: string) => Promise<void>;
type Mkdir = (path: string, options: { mode?: number; recursive?: boolean }) => Promise<void>;
type ReadFile = (path: string, encoding: BufferEncoding) => Promise<string>;
type Readdir = (path: string, options: { withFileTypes: true }) => Promise<Dirent[]>;
type Rename = (oldPath: string, newPath: string) => Promise<void>;
type Rm = (path: string, options: { force: boolean }) => Promise<void>;
type RunCommand = (command: readonly string[]) => Promise<CommandResult>;
type WriteFile = (path: string, contents: string, options: { encoding: BufferEncoding; mode: number }) => Promise<void>;
type WriteFileCall = [path: string, contents: string, options: { encoding: BufferEncoding; mode: number }];
type IsSea = () => boolean;
type Lstat = (path: string) => Promise<MockStats>;
type MockCallValue = boolean | null | number | object | string | undefined;

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

interface MockStatsInput {
  readonly directory?: boolean | undefined;
  readonly file?: boolean | undefined;
  readonly gid?: number | undefined;
  readonly mode?: number | undefined;
  readonly symlink?: boolean | undefined;
  readonly uid?: number | undefined;
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
  readdir: Mock<Readdir>;
  rename: Mock<Rename>;
  rm: Mock<Rm>;
  runCommand: Mock<RunCommand>;
  writeFile: Mock<WriteFile>;
}

interface ProcessWithGetuid extends NodeJS.Process {
  getuid: () => number;
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
    readdir: vi.fn<Readdir>(),
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
    readdir: Mock<Readdir>;
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
    readdir: mocks.readdir,
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
  vi.restoreAllMocks();
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
  mocks.readFile.mockResolvedValue(defaultSelfHostedEnvironmentText());
  mocks.readdir.mockReset();
  mocks.readdir.mockResolvedValue([]);
  mocks.rename.mockReset();
  mocks.rm.mockReset();
  mocks.runCommand.mockReset();
  mocks.runCommand.mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });
  mocks.writeFile.mockReset();
  mockRootPrivileges();
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

    await stageNodeAgentHostService({
      envPath: '/etc/compartment/.env.self-hosted',
      repairRuntimeWritableDirectoryContents: true,
    });

    const unitContents: string = readWrittenSystemdUnit();
    expect(unitContents).toContain('EnvironmentFile=/etc/compartment/.env.self-hosted');
    expect(unitContents).toContain('NoNewPrivileges=true');
    expect(unitContents).toContain('ProtectSystem=strict');
    expect(unitContents).toContain('Group=compartment-runtime');
    expect(unitContents).toContain('RuntimeDirectory=compartment/node');
    expect(unitContents).not.toContain('compartment/api');
    expect(unitContents).toContain('RuntimeDirectoryMode=0750');
    expect(unitContents).toContain('RuntimeDirectoryPreserve=yes');
    expect(unitContents).toContain('StateDirectory=compartment/self-hosted');
    expect(unitContents).not.toContain('StateDirectory=compartment/self-hosted compartment/resource-backups');
    expect(unitContents).toContain('StateDirectoryMode=0700');
    expect(unitContents).toContain(
      'ReadWritePaths=/var/run/compartment/node /var/lib/compartment/self-hosted /var/lib/compartment/resource-backups /var/run/docker.sock',
    );
    expect(unitContents).toContain('UMask=0007');
    expect(unitContents).not.toContain('ExecStartPre=');
    expect(mocks.runCommand).toHaveBeenCalledWith(['getent', 'group', 'compartment-runtime']);
    expect(mocks.runCommand).toHaveBeenCalledWith(['getent', 'group', '10001']);
    expect(mocks.runCommand).toHaveBeenCalledWith(['groupadd', '--system', '--gid', '10001', 'compartment-runtime']);
    expect(mocks.chown).toHaveBeenCalledWith('/var/run/compartment/api', 10001, 10001);
    expect(mocks.chmod).toHaveBeenCalledWith('/var/run/compartment/api', 0o700);
    expect(mocks.chown).toHaveBeenCalledWith('/var/run/compartment/node', 0, 10001);
    expect(mocks.chmod).toHaveBeenCalledWith('/var/run/compartment/node', 0o750);
    expect(mocks.chown).toHaveBeenCalledWith('/var/lib/compartment/self-hosted/docker-work', 10001, 10001);
    expect(mocks.chown).toHaveBeenCalledWith('/var/lib/compartment/source-archives', 10001, 10001);
    expect(mocks.chown).toHaveBeenCalledWith('/var/lib/compartment/resource-backups', 10001, 10001);
    expect(mocks.chown).toHaveBeenCalledWith('/var/lib/compartment/audit-logs', 10001, 10001);
    expect(mocks.chown).toHaveBeenCalledWith('/etc/compartment/tls', 0, 10001);
    expect(mocks.chmod).toHaveBeenCalledWith('/etc/compartment/tls', 0o750);
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

    await expect(
      stageNodeAgentHostService({
        envPath: '/etc/compartment/.env.self-hosted',
        repairRuntimeWritableDirectoryContents: true,
      }),
    ).rejects.toThrow('Compartment runtime directory /var/run/compartment must be a real directory.');
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(mocks.chown).not.toHaveBeenCalled();
    expect(mocks.chmod).not.toHaveBeenCalled();
  });

  it('repairs root-owned runtime tree contents before handing the root to the runtime user', async (): Promise<void> => {
    mocks.readdir.mockImplementation(async (path: string): Promise<Dirent[]> => {
      await Promise.resolve();
      if (path === '/var/lib/compartment/self-hosted/docker-work') {
        return [createDirent('build-cache', 'directory')];
      }
      if (path === '/var/lib/compartment/source-archives') {
        return [createDirent('archive.tar', 'file'), createDirent('nested', 'directory')];
      }
      return [];
    });
    mocks.lstat.mockImplementation(async (path: string): Promise<MockStats> => {
      await Promise.resolve();
      if (path === '/var/lib/compartment/source-archives/archive.tar') {
        return createStats({ file: true });
      }
      return createStats({ directory: true });
    });
    const { stageNodeAgentHostService } = await import('../src/node-agent-service');

    await stageNodeAgentHostService({
      envPath: '/etc/compartment/.env.self-hosted',
      repairRuntimeWritableDirectoryContents: true,
    });

    expect(mocks.chown).toHaveBeenCalledWith('/var/lib/compartment/source-archives/archive.tar', 10001, 10001);
    expect(mocks.chmod).toHaveBeenCalledWith('/var/lib/compartment/source-archives/archive.tar', 0o600);
    expect(mocks.chown).toHaveBeenCalledWith('/var/lib/compartment/source-archives/nested', 10001, 10001);
    expect(mocks.chmod).toHaveBeenCalledWith('/var/lib/compartment/source-archives/nested', 0o700);
    expect(mocks.chown).toHaveBeenCalledWith('/var/lib/compartment/self-hosted/docker-work/build-cache', 10001, 10001);
    expect(mocks.chmod).toHaveBeenCalledWith('/var/lib/compartment/self-hosted/docker-work/build-cache', 0o700);
    expect(readCallOrder(mocks.chown, '/var/lib/compartment/source-archives', 10001, 10001)).toBeLessThan(
      readCallOrder(mocks.chown, '/var/lib/compartment/source-archives/archive.tar', 10001, 10001),
    );
  });

  it('skips runtime-owned tree content repair unless the caller declares the runtime stopped', async (): Promise<void> => {
    mocks.lstat.mockImplementation(async (path: string): Promise<MockStats> => {
      await Promise.resolve();
      if (path === '/var/lib/compartment/source-archives') {
        return createStats({ directory: true, gid: 10001, mode: 0o770, uid: 0 });
      }
      return createStats({ directory: true });
    });
    const { stageNodeAgentHostService } = await import('../src/node-agent-service');

    await stageNodeAgentHostService({
      envPath: '/etc/compartment/.env.self-hosted',
      repairRuntimeWritableDirectoryContents: false,
    });
    expect(mocks.readdir).not.toHaveBeenCalledWith('/var/lib/compartment/source-archives', expect.anything());
    expect(mocks.readdir).not.toHaveBeenCalledWith('/var/lib/compartment/self-hosted/docker-work', expect.anything());
  });

  it('rejects an existing runtime group with a different GID', async (): Promise<void> => {
    mocks.runCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
      await Promise.resolve();
      if (command.join(' ') === 'getent group compartment-runtime') {
        return { exitCode: 0, stderr: '', stdout: 'compartment-runtime:x:12345:\n' };
      }
      return { exitCode: 0, stderr: '', stdout: '' };
    });
    const { stageNodeAgentHostService } = await import('../src/node-agent-service');

    await expect(
      stageNodeAgentHostService({
        envPath: '/etc/compartment/.env.self-hosted',
        repairRuntimeWritableDirectoryContents: true,
      }),
    ).rejects.toThrow('Host group compartment-runtime has GID 12345; expected 10001.');
    expect(mocks.runCommand).not.toHaveBeenCalledWith([
      'groupadd',
      '--system',
      '--gid',
      '10001',
      'compartment-runtime',
    ]);
  });

  it('rejects a runtime GID assigned to a different host group', async (): Promise<void> => {
    mocks.runCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
      await Promise.resolve();
      if (command.join(' ') === 'getent group compartment-runtime') {
        return { exitCode: 2, stderr: '', stdout: '' };
      }
      if (command.join(' ') === 'getent group 10001') {
        return { exitCode: 0, stderr: '', stdout: 'other-runtime:x:10001:\n' };
      }
      return { exitCode: 0, stderr: '', stdout: '' };
    });
    const { stageNodeAgentHostService } = await import('../src/node-agent-service');

    await expect(
      stageNodeAgentHostService({
        envPath: '/etc/compartment/.env.self-hosted',
        repairRuntimeWritableDirectoryContents: true,
      }),
    ).rejects.toThrow('Host GID 10001 is already assigned to group other-runtime; expected compartment-runtime.');
    expect(mocks.runCommand).not.toHaveBeenCalledWith([
      'groupadd',
      '--system',
      '--gid',
      '10001',
      'compartment-runtime',
    ]);
  });

  it('surfaces runtime group creation failures', async (): Promise<void> => {
    mocks.runCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
      await Promise.resolve();
      if (command[0] === 'getent') {
        return { exitCode: 2, stderr: '', stdout: '' };
      }
      if (command[0] === 'groupadd') {
        return { exitCode: 1, stderr: 'groupadd failed', stdout: '' };
      }
      return { exitCode: 0, stderr: '', stdout: '' };
    });
    const { stageNodeAgentHostService } = await import('../src/node-agent-service');

    await expect(
      stageNodeAgentHostService({
        envPath: '/etc/compartment/.env.self-hosted',
        repairRuntimeWritableDirectoryContents: true,
      }),
    ).rejects.toThrow('Failed to create host group compartment-runtime with GID 10001.\ngroupadd failed');
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

    await expect(
      stageNodeAgentHostService({
        envPath: '/etc/compartment/.env.self-hosted',
        repairRuntimeWritableDirectoryContents: true,
      }),
    ).rejects.toThrow('compartment-node-agent can only be installed from the self-contained compartment binary.');
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

function mockRootPrivileges(): void {
  const processWithGetuid: ProcessWithGetuid = process as ProcessWithGetuid;
  vi.spyOn(processWithGetuid, 'getuid').mockReturnValue(0);
}

function defaultSelfHostedEnvironmentText(): string {
  return `COMPARTMENT_RUNTIME_UID=10001
COMPARTMENT_RUNTIME_GID=10001
COMPARTMENT_DOCKER_WORK_DIR=/var/lib/compartment/self-hosted/docker-work
COMPARTMENT_SOURCE_ARCHIVE_DIR=/var/lib/compartment/source-archives
COMPARTMENT_RESOURCE_BACKUP_DIR=/var/lib/compartment/resource-backups
COMPARTMENT_AUDIT_FILE_SINK_DIR=/var/lib/compartment/audit-logs
COMPARTMENT_CUSTOM_TLS_DIR=/etc/compartment/tls
COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/node/agent.sock
`;
}

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

function readCallOrder(mock: Mock, ...expected: readonly MockCallValue[]): number {
  const calls: readonly (readonly MockCallValue[])[] = mock.mock.calls as readonly (readonly MockCallValue[])[];
  const index: number = calls.findIndex((call: readonly MockCallValue[]): boolean => {
    return expected.every((expectedValue: MockCallValue, valueIndex: number): boolean => {
      return call[valueIndex] === expectedValue;
    });
  });
  expect(index).toBeGreaterThanOrEqual(0);
  return mock.mock.invocationCallOrder[index]!;
}

function createDirent(name: string, kind: 'directory' | 'file'): Dirent {
  return new MockDirent(name, kind);
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

function createStats(input: MockStatsInput): MockStats {
  return new MockStats(input);
}

class MockDirent {
  public readonly name: string;
  public readonly parentPath: string = '';
  private readonly kind: 'directory' | 'file';

  public constructor(name: string, kind: 'directory' | 'file') {
    this.name = name;
    this.kind = kind;
  }

  public isDirectory(): boolean {
    return this.kind === 'directory';
  }

  public isFile(): boolean {
    return this.kind === 'file';
  }

  public isBlockDevice(): boolean {
    return false;
  }

  public isCharacterDevice(): boolean {
    return false;
  }

  public isFIFO(): boolean {
    return false;
  }

  public isSocket(): boolean {
    return false;
  }

  public isSymbolicLink(): boolean {
    return false;
  }
}

class MockStats {
  private readonly directory: boolean;
  private readonly file: boolean;
  private readonly symlink: boolean;
  public readonly gid: number;
  public readonly mode: number;
  public readonly uid: number;

  public constructor(input: MockStatsInput) {
    this.directory = input.directory === true;
    this.file = input.file === true;
    this.symlink = input.symlink === true;
    this.gid = input.gid ?? 0;
    this.mode = input.mode ?? 0o700;
    this.uid = input.uid ?? 0;
  }

  public isDirectory(): boolean {
    return this.directory;
  }

  public isFile(): boolean {
    return this.file;
  }

  public isSymbolicLink(): boolean {
    return this.symlink;
  }
}
