import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { installDockerEngine } from '../src/docker-install';

type CanRunCommand = (command: readonly string[], env?: NodeJS.ProcessEnv) => Promise<boolean>;
type ReportProgress = (message: string) => void;
type ReadFile = (path: string, encoding: BufferEncoding) => Promise<string>;
type RunCappedCommand = (command: readonly string[], env?: NodeJS.ProcessEnv) => Promise<CommandResult>;
type RunCommand = (command: readonly string[], env?: NodeJS.ProcessEnv) => Promise<CommandResult>;
type RunInheritedCommand = (command: readonly string[], env?: NodeJS.ProcessEnv) => Promise<CommandResult>;

interface DockerInstallTestMocks {
  canRunCommand: Mock<CanRunCommand>;
  readFile: Mock<ReadFile>;
  runCappedCommand: Mock<RunCappedCommand>;
  runCommand: Mock<RunCommand>;
  runInheritedCommand: Mock<RunInheritedCommand>;
}

const mocks: DockerInstallTestMocks = vi.hoisted(
  (): DockerInstallTestMocks => ({
    canRunCommand: vi.fn<CanRunCommand>(),
    readFile: vi.fn<ReadFile>(),
    runCappedCommand: vi.fn<RunCappedCommand>(),
    runCommand: vi.fn<RunCommand>(),
    runInheritedCommand: vi.fn<RunInheritedCommand>(),
  }),
);

vi.mock('../src/command-runner', (): object => ({
  canRunCommand: mocks.canRunCommand,
  readCommandOutput: (result: CommandResult): string =>
    [result.stderr.trim(), result.stdout.trim()].filter((value: string): boolean => value !== '').join('\n'),
  runCappedCommand: mocks.runCappedCommand,
  runCommand: mocks.runCommand,
  runInheritedCommand: mocks.runInheritedCommand,
}));

vi.mock('node:fs/promises', (): { readFile: Mock<ReadFile> } => ({
  readFile: mocks.readFile,
}));

describe('installDockerEngine', (): void => {
  afterEach((): void => {
    mocks.canRunCommand.mockReset();
    mocks.readFile.mockReset();
    mocks.runCappedCommand.mockReset();
    mocks.runCommand.mockReset();
    mocks.runInheritedCommand.mockReset();
    restoreProcessGetuid();
    restoreProcessCompartment();
    restoreProcessStdinIsTTY();
  });

  it('installs Docker on Ubuntu with passwordless sudo', async (): Promise<void> => {
    const reportProgressMock: Mock<ReportProgress> = vi.fn<ReportProgress>();
    setProcessCompartment('linux');
    setProcessGetuid(1000);
    setProcessStdinIsTTY(true);
    mocks.readFile.mockResolvedValueOnce('ID=ubuntu\nVERSION_CODENAME=noble\n');
    mocks.canRunCommand.mockResolvedValueOnce(true);
    mocks.runCappedCommand.mockResolvedValue(createSuccessfulCommandResult());

    await installDockerEngine(reportProgressMock);

    expect(mocks.canRunCommand).toHaveBeenCalledWith(['sudo', '-n', 'true']);
    expectRunCappedCommandCall(['sudo', '-n', 'apt-get', 'install', '-y', 'ca-certificates', 'curl']);
    expectRunCappedShellCommand('sudo-n', 'https://download.docker.com/linux/ubuntu/gpg');
    expectRunCappedShellCommand('sudo-n', '/etc/apt/sources.list.d/docker.sources');
    expectRunCappedShellCommand('sudo-n', 'Suites: noble');
    expectRunCappedCommandCall([
      'sudo',
      '-n',
      'apt-get',
      'install',
      '-y',
      'docker-ce',
      'docker-ce-cli',
      'containerd.io',
      'docker-buildx-plugin',
      'docker-compose-plugin',
    ]);
    expect(mocks.runInheritedCommand).not.toHaveBeenCalled();
    expect(mocks.runCommand).not.toHaveBeenCalled();
    expect(reportProgressMock.mock.calls.map((call: [message: string]): string => call[0])).toEqual([
      'Docker Engine is missing. Installing Docker Engine and the Docker Compose plugin...',
      'Automatic Docker installation is using cached sudo access.',
      'Configuring the Docker apt repository for ubuntu noble...',
      'Installing Docker Engine packages...',
    ]);
  });

  it('installs Docker on Ubuntu with interactive sudo', async (): Promise<void> => {
    const reportProgressMock: Mock<ReportProgress> = vi.fn<ReportProgress>();
    setProcessCompartment('linux');
    setProcessGetuid(1000);
    setProcessStdinIsTTY(true);
    mocks.readFile.mockResolvedValueOnce('ID=ubuntu\nVERSION_CODENAME=noble\n');
    mocks.canRunCommand.mockResolvedValueOnce(false);
    mocks.runInheritedCommand.mockResolvedValueOnce(createSuccessfulCommandResult());
    mocks.runCappedCommand.mockResolvedValue(createSuccessfulCommandResult());

    await installDockerEngine(reportProgressMock);

    expect(mocks.canRunCommand).toHaveBeenCalledWith(['sudo', '-n', 'true']);
    expectRunInheritedCommandCall(['sudo', '-v']);
    expectRunCappedCommandCall(['sudo', 'apt-get', 'install', '-y', 'ca-certificates', 'curl']);
    expectRunCappedShellCommand('sudo', 'https://download.docker.com/linux/ubuntu/gpg');
    expectRunCappedShellCommand('sudo', '/etc/apt/sources.list.d/docker.sources');
    expectRunCappedShellCommand('sudo', 'Suites: noble');
    expectRunCappedCommandCall([
      'sudo',
      'apt-get',
      'install',
      '-y',
      'docker-ce',
      'docker-ce-cli',
      'containerd.io',
      'docker-buildx-plugin',
      'docker-compose-plugin',
    ]);
    expect(mocks.runCommand).not.toHaveBeenCalled();
    expect(reportProgressMock.mock.calls.map((call: [message: string]): string => call[0])).toEqual([
      'Docker Engine is missing. Installing Docker Engine and the Docker Compose plugin...',
      'Automatic Docker installation requires sudo; you may be prompted for your password.',
      'Configuring the Docker apt repository for ubuntu noble...',
      'Installing Docker Engine packages...',
    ]);
  });

  it('rejects unsupported Linux distributions', async (): Promise<void> => {
    setProcessCompartment('linux');
    setProcessGetuid(0);
    mocks.readFile.mockResolvedValueOnce('ID=fedora\nVERSION_CODENAME=41\n');

    await expect(installDockerEngine()).rejects.toThrow(
      'Automatic Docker installation is supported only on Ubuntu and Debian Linux hosts. Install Docker manually and re-run `compartment install`.',
    );
    expect(mocks.canRunCommand).not.toHaveBeenCalled();
    expect(mocks.runCommand).not.toHaveBeenCalled();
    expect(mocks.runInheritedCommand).not.toHaveBeenCalled();
  });

  it('requires root or sudo access', async (): Promise<void> => {
    setProcessCompartment('linux');
    setProcessGetuid(1000);
    setProcessStdinIsTTY(false);
    mocks.readFile.mockResolvedValueOnce('ID=ubuntu\nVERSION_CODENAME=noble\n');
    mocks.canRunCommand.mockResolvedValueOnce(false);

    await expect(installDockerEngine()).rejects.toThrow(
      'Automatic Docker installation requires root or sudo access on supported Linux hosts. Install Docker manually or re-run `compartment install` in an interactive shell with sudo access.',
    );
    expect(mocks.runInheritedCommand).not.toHaveBeenCalled();
  });

  it('returns the captured package-manager error when Docker installation fails', async (): Promise<void> => {
    setProcessCompartment('linux');
    setProcessGetuid(0);
    mocks.readFile.mockResolvedValueOnce('ID=ubuntu\nVERSION_CODENAME=noble\n');
    mocks.runCappedCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult())
      .mockResolvedValueOnce(createSuccessfulCommandResult())
      .mockResolvedValueOnce(createSuccessfulCommandResult())
      .mockResolvedValueOnce(createSuccessfulCommandResult())
      .mockResolvedValueOnce(createSuccessfulCommandResult())
      .mockResolvedValueOnce(createSuccessfulCommandResult())
      .mockResolvedValueOnce(
        createFailedCommandResult('The following signatures could not be verified: NO_PUBKEY', 100),
      );

    await expect(installDockerEngine()).rejects.toThrow(
      'Failed to install Docker Engine packages.\nThe following signatures could not be verified: NO_PUBKEY',
    );
  });
});

function createSuccessfulCommandResult(stdout: string = ''): CommandResult {
  return {
    exitCode: 0,
    stderr: '',
    stdout,
  };
}

function expectRunInheritedCommandCall(expectedCommand: readonly string[]): void {
  expect(readCommands(mocks.runInheritedCommand)).toContainEqual(expectedCommand);
}

function expectRunCappedCommandCall(expectedCommand: readonly string[]): void {
  expect(readCommands(mocks.runCappedCommand)).toContainEqual(expectedCommand);
}

function expectRunCappedShellCommand(mode: RootCommandShellMode, expectedSnippet: string): void {
  const shellScripts: string[] = readCommands(mocks.runCappedCommand)
    .filter((command: readonly string[]): boolean => matchesRootShellCommand(mode, command))
    .map((command: readonly string[]): string => readRootShellScript(mode, command));
  expect(shellScripts.some((script: string): boolean => script.includes(expectedSnippet))).toBe(true);
}

type RootCommandShellMode = 'sudo' | 'sudo-n';

function matchesRootShellCommand(mode: RootCommandShellMode, command: readonly string[]): boolean {
  return mode === 'sudo'
    ? command[0] === 'sudo' && command[1] === 'sh'
    : command[0] === 'sudo' && command[1] === '-n' && command[2] === 'sh';
}

function readRootShellScript(mode: RootCommandShellMode, command: readonly string[]): string {
  return mode === 'sudo' ? (command[3] ?? '') : (command[4] ?? '');
}

function createFailedCommandResult(stderr: string, exitCode: number): CommandResult {
  return {
    exitCode,
    stderr,
    stdout: '',
  };
}

function readCommands(
  mock: Mock<RunCappedCommand> | Mock<RunCommand> | Mock<RunInheritedCommand>,
): readonly (readonly string[])[] {
  return mock.mock.calls.map(
    (call: [command: readonly string[], env?: NodeJS.ProcessEnv | undefined]): readonly string[] => call[0],
  );
}

const originalGetuid: (() => number) | undefined = process.getuid;
const originalCompartment: string = process.platform;
const originalStdinIsTTY: boolean | undefined = process.stdin.isTTY;

function setProcessGetuid(userId: number): void {
  Object.defineProperty(process, 'getuid', {
    configurable: true,
    value: (): number => userId,
  });
}

function restoreProcessGetuid(): void {
  Object.defineProperty(process, 'getuid', {
    configurable: true,
    value: originalGetuid,
  });
}

function setProcessCompartment(targetPlatform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: targetPlatform,
  });
}

function restoreProcessCompartment(): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: originalCompartment,
  });
}

function setProcessStdinIsTTY(isTTY: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: isTTY,
  });
}

function restoreProcessStdinIsTTY(): void {
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: originalStdinIsTTY,
  });
}
