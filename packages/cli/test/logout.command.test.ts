import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { LogoutResponse } from '@compartment/contracts';
import type { AuthenticatedContext } from '../src/services/context.types';
import type { CliConfig } from '../src/store/config.types';
import { createCliConfigFixture } from './cli-test.fixtures';
import {
  type CliCommandResult,
  createCliCapture,
  expectCliFailure,
  expectCliSuccess,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
} from './cli-test.harness';

interface LogoutCommandMocks {
  clearCliConfigMock: Mock<ClearCliConfig>;
  logoutMock: Mock<Logout>;
  readCliConfigMock: Mock<ReadCliConfig>;
  writeCliConfigMock: Mock<WriteCliConfig>;
}

interface LogoutCommandServiceModule {
  logout: Mock<Logout>;
}

interface LogoutCommandConfigStoreModule {
  clearCliConfig: Mock<ClearCliConfig>;
  readCliConfig: Mock<ReadCliConfig>;
  writeCliConfig: Mock<WriteCliConfig>;
}

type ClearCliConfig = () => Promise<void>;
type Logout = (context: AuthenticatedContext) => Promise<LogoutResponse>;
type ReadCliConfig = () => Promise<CliConfig>;
type WriteCliConfig = (config: CliConfig) => Promise<void>;

const createdDirectories: string[] = [];
const commandTestTimeoutMs: number = 10000;

describe.sequential('compartment logout command', (): void => {
  let previousCwd: string;

  beforeEach((): void => {
    previousCwd = process.cwd();
    resetCliCommandModules();
  });

  afterEach(async (): Promise<void> => {
    process.chdir(previousCwd);
    restoreCliCommandModules(['../src/services/logout.service', '../src/store/config.store']);
    await Promise.all(
      createdDirectories.splice(0).map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
  });

  it(
    'logs out the repo-selected remote instead of the global current remote',
    async (): Promise<void> => {
      const cwd: string = await createProjectDirectory();
      process.chdir(cwd);
      const mocks: LogoutCommandMocks = mockLogoutCommandModules(
        createCliConfigFixture({
          currentRemote: 'default',
          remotes: {
            default: {
              apiUrl: 'https://default.example.com',
              sessionToken: 'default-session',
            },
            eu: {
              apiUrl: 'https://eu.example.com',
              sessionToken: 'eu-session',
            },
          },
        }),
      );

      const result: CliCommandResult = await runCliCommand(['logout'], createCliCapture());

      expectCliSuccess(result);
      expect(mocks.logoutMock).toHaveBeenCalledWith({
        apiUrl: 'https://eu.example.com',
        currentOrganization: undefined,
        remoteName: 'eu',
        sessionToken: 'eu-session',
      });
      expect(mocks.writeCliConfigMock).toHaveBeenCalledWith({
        currentRemote: 'default',
        remotes: {
          default: {
            apiUrl: 'https://default.example.com',
            sessionToken: 'default-session',
          },
          eu: {
            apiUrl: 'https://eu.example.com',
          },
        },
      });
      expect(mocks.clearCliConfigMock).not.toHaveBeenCalled();
    },
    commandTestTimeoutMs,
  );

  it('fails for an unknown explicit remote instead of clearing all config', async (): Promise<void> => {
    const mocks: LogoutCommandMocks = mockLogoutCommandModules(createCliConfigFixture());

    const result: CliCommandResult = await runCliCommand(['logout', '--remote', 'missing'], createCliCapture());

    expectCliFailure(
      result,
      'Remote "missing" is not configured. Run `compartment login --remote missing --api-url <url>` first.',
    );
    expect(mocks.clearCliConfigMock).not.toHaveBeenCalled();
    expect(mocks.writeCliConfigMock).not.toHaveBeenCalled();
  });

  it('fails when remotes exist but none is selected', async (): Promise<void> => {
    const mocks: LogoutCommandMocks = mockLogoutCommandModules({
      remotes: {
        lab: {
          apiUrl: 'https://lab.example.com',
        },
      },
    });

    const result: CliCommandResult = await runCliCommand(['logout'], createCliCapture());

    expectCliFailure(
      result,
      'No remote is selected. Pass --remote <name> or run `compartment remote use <name>` first.',
    );
    expect(mocks.clearCliConfigMock).not.toHaveBeenCalled();
    expect(mocks.logoutMock).not.toHaveBeenCalled();
    expect(mocks.writeCliConfigMock).not.toHaveBeenCalled();
  });

  it('clears the local config when no remotes are stored', async (): Promise<void> => {
    const mocks: LogoutCommandMocks = mockLogoutCommandModules({});

    const result: CliCommandResult = await runCliCommand(['logout'], createCliCapture());

    expectCliSuccess(result);
    expect(mocks.clearCliConfigMock).toHaveBeenCalledOnce();
    expect(mocks.logoutMock).not.toHaveBeenCalled();
    expect(mocks.writeCliConfigMock).not.toHaveBeenCalled();
  });
});

function mockLogoutCommandModules(config: CliConfig): LogoutCommandMocks {
  const clearCliConfigMock: Mock<ClearCliConfig> = vi.fn<ClearCliConfig>().mockResolvedValue(undefined);
  const logoutMock: Mock<Logout> = vi.fn<Logout>().mockResolvedValue({ success: true });
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(config);
  const writeCliConfigMock: Mock<WriteCliConfig> = vi.fn<WriteCliConfig>().mockResolvedValue(undefined);

  vi.doMock(
    '../src/services/logout.service',
    (): LogoutCommandServiceModule => ({
      logout: logoutMock,
    }),
  );
  vi.doMock(
    '../src/store/config.store',
    (): LogoutCommandConfigStoreModule => ({
      clearCliConfig: clearCliConfigMock,
      readCliConfig: readCliConfigMock,
      writeCliConfig: writeCliConfigMock,
    }),
  );

  return {
    clearCliConfigMock,
    logoutMock,
    readCliConfigMock,
    writeCliConfigMock,
  };
}

async function createTempDirectory(prefix: string): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), prefix));
  createdDirectories.push(directory);
  return directory;
}

async function createProjectDirectory(): Promise<string> {
  const cwd: string = await createTempDirectory('compartment-cli-logout-command-');
  await mkdir(join(cwd, '.compartment'), { recursive: true });
  await writeFile(join(cwd, 'compartment.yml'), 'name: web\nservices:\n  web: .\n', 'utf8');
  await writeFile(
    join(cwd, '.compartment', 'state.json'),
    `${JSON.stringify({ selectedRemote: 'eu' }, null, 2)}\n`,
    'utf8',
  );
  return cwd;
}
