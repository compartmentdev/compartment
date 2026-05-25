import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  type CliCommandCapture,
  createCliCapture,
  expectCliFailure,
  expectCliSuccess,
  readCliStderr,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  type CliCommandResult,
} from './cli-test.harness';
import type { CommandResult } from '../src/command-runner.types';
import type {
  SelfHostedInstallInput,
  SelfHostedInstallPreflightInput,
  SelfHostedInstallResult,
} from '../src/install.types';
import type { InstallInput } from '../src/services/install.service.types';

type InstallDev = (input: Omit<InstallInput, 'baseDomain'>) => Promise<SelfHostedInstallResult>;
type InstallSelfHosted = (input: SelfHostedInstallInput) => Promise<SelfHostedInstallResult>;
type PreflightSelfHostedInstall = (input: SelfHostedInstallPreflightInput) => Promise<void>;
type RerunSelfHostedCommandWithSudoIfNeeded = () => Promise<CommandResult | undefined>;
type AssertNodeAgentHostServiceInstallable = () => void;

const originalCompartmentCliConfigDir: string | undefined = process.env.COMPARTMENT_CLI_CONFIG_DIR;
const createdDirectories: string[] = [];

vi.mock(
  '../src/self-hosted-sudo-rerun',
  (): { rerunSelfHostedCommandWithSudoIfNeeded: Mock<RerunSelfHostedCommandWithSudoIfNeeded> } => ({
    rerunSelfHostedCommandWithSudoIfNeeded: vi
      .fn<RerunSelfHostedCommandWithSudoIfNeeded>()
      .mockResolvedValue(undefined),
  }),
);

vi.mock(
  '../src/node-agent-service',
  (): { assertNodeAgentHostServiceInstallable: Mock<AssertNodeAgentHostServiceInstallable> } => ({
    assertNodeAgentHostServiceInstallable: vi.fn<AssertNodeAgentHostServiceInstallable>(),
  }),
);

describe.sequential('compartment install command public port prompts', (): void => {
  afterEach(async (): Promise<void> => {
    restoreConfigDirectoryEnv();
    await removeCreatedDirectories();
    restoreCliCommandModules([
      '../src/install',
      '../src/cli-build-info',
      '../src/prompts/prompt',
      '../src/public-ip',
      '../src/services/managed-domain.service',
    ]);
  });

  it('lets the user decline Docker installation before prompting for the admin password', async (): Promise<void> => {
    resetCliCommandModules();
    vi.doMock(
      '../src/install',
      (): {
        installDev: Mock<InstallDev>;
        installSelfHosted: Mock<InstallSelfHosted>;
        preflightSelfHostedInstall: Mock<PreflightSelfHostedInstall>;
      } => ({
        installDev: vi.fn<InstallDev>(),
        installSelfHosted: vi.fn<InstallSelfHosted>(),
        preflightSelfHostedInstall: vi
          .fn<PreflightSelfHostedInstall>()
          .mockImplementation(async (input: SelfHostedInstallPreflightInput): Promise<void> => {
            const installDocker: boolean = (await input.context?.confirmInstallWhenMissing?.()) ?? false;
            if (installDocker) {
              throw new Error('Expected Docker installation refusal in command test.');
            }

            throw new Error(
              'Docker installation was skipped. Install Docker manually and re-run `compartment install` or `compartment system update`.',
            );
          }),
      }),
    );
    const capture: CliCommandCapture = createCliCapture({
      isTTY: true,
    });
    capture.stdin.end('n\nsupersecretpassword\nsupersecretpassword\n');

    const result: CliCommandResult = await runCliCommand(
      [
        'install',
        '--email',
        'admin@example.com',
        '--organization',
        'Acme Dev',
        '--public-http-port',
        '80',
        '--public-https-port',
        '443',
      ],
      capture,
    );

    expectCliFailure(
      result,
      'Docker installation was skipped. Install Docker manually and re-run `compartment install` or `compartment system update`.',
    );
    expect(readCliStderr(capture)).toContain(
      'Docker is not installed. Install Docker Engine and the Docker Compose plugin now? [Y/n]: ',
    );
    expect(readCliStderr(capture)).not.toContain('Admin password: ');
    expect(readCliStderr(capture)).not.toContain('Confirm password: ');
  });

  it('does not prompt for public ports when the default self-hosted ports pass preflight', async (): Promise<void> => {
    resetCliCommandModules();
    vi.doMock(
      '../src/install',
      (): {
        installDev: Mock<InstallDev>;
        installSelfHosted: Mock<InstallSelfHosted>;
        preflightSelfHostedInstall: Mock<PreflightSelfHostedInstall>;
      } => ({
        installDev: vi.fn<InstallDev>(),
        installSelfHosted: vi.fn<InstallSelfHosted>().mockResolvedValue(createInstallResult()),
        preflightSelfHostedInstall: vi.fn<PreflightSelfHostedInstall>().mockResolvedValue(undefined),
      }),
    );
    const capture: CliCommandCapture = createCliCapture({
      isTTY: true,
    });
    capture.stdin.end('supersecretpassword\nsupersecretpassword\n');

    const result: CliCommandResult = await runCliCommand(
      ['install', '--base-domain', 'example.com', '--email', 'admin@example.com', '--organization', 'Acme Dev'],
      capture,
    );

    expectCliSuccess(result);
    expect(readCliStderr(capture)).not.toContain('Public HTTP port [80]: ');
    expect(readCliStderr(capture)).not.toContain('Public HTTPS port [443]: ');
  });

  it('re-prompts for a public port only after preflight reports that the default port is occupied', async (): Promise<void> => {
    resetCliCommandModules();
    const { InstallPublicPortOccupiedError } = await import('../src/install-public-port-preflight');
    const installSelfHostedMock: Mock<InstallSelfHosted> = vi
      .fn<InstallSelfHosted>()
      .mockResolvedValue(createInstallResult());
    const preflightSelfHostedInstallMock: Mock<PreflightSelfHostedInstall> = vi
      .fn<PreflightSelfHostedInstall>()
      .mockRejectedValueOnce(
        new InstallPublicPortOccupiedError({
          label: 'Public HTTP port',
          optionName: '--public-http-port',
          port: 80,
        }),
      )
      .mockResolvedValueOnce(undefined);
    vi.doMock(
      '../src/install',
      (): {
        installDev: Mock<InstallDev>;
        installSelfHosted: Mock<InstallSelfHosted>;
        preflightSelfHostedInstall: Mock<PreflightSelfHostedInstall>;
      } => ({
        installDev: vi.fn<InstallDev>(),
        installSelfHosted: installSelfHostedMock,
        preflightSelfHostedInstall: preflightSelfHostedInstallMock,
      }),
    );
    const capture: CliCommandCapture = createCliCapture({
      isTTY: true,
    });
    capture.stdin.end('8080\nsupersecretpassword\nsupersecretpassword\n');

    const result: CliCommandResult = await runCliCommand(
      ['install', '--base-domain', 'example.com', '--email', 'admin@example.com', '--organization', 'Acme Dev'],
      capture,
    );

    expectCliSuccess(result);
    const firstPreflightInput: SelfHostedInstallPreflightInput | undefined =
      preflightSelfHostedInstallMock.mock.calls[0]?.[0];
    const secondPreflightInput: SelfHostedInstallPreflightInput | undefined =
      preflightSelfHostedInstallMock.mock.calls[1]?.[0];
    const installSelfHostedInput: SelfHostedInstallInput | undefined = installSelfHostedMock.mock.calls[0]?.[0];

    expect(firstPreflightInput?.options.publicHttpPort).toBe(80);
    expect(firstPreflightInput?.options.publicHttpsPort).toBe(443);
    expect(secondPreflightInput?.options.publicHttpPort).toBe(8080);
    expect(secondPreflightInput?.options.publicHttpsPort).toBe(443);
    expect(installSelfHostedInput?.options.publicHttpPort).toBe(8080);
    expect(installSelfHostedInput?.options.publicHttpsPort).toBe(443);
    expect(countOccurrences(readCliStderr(capture), 'Public HTTP port [80]: ')).toBe(1);
    expect(readCliStderr(capture)).not.toContain('Public HTTPS port [443]: ');
  });

  it('fails fast in non-interactive mode when an occupied-port retry prompt cannot change the input', async (): Promise<void> => {
    resetCliCommandModules();
    const { InstallPublicPortOccupiedError } = await import('../src/install-public-port-preflight');
    const installSelfHostedMock: Mock<InstallSelfHosted> = vi
      .fn<InstallSelfHosted>()
      .mockResolvedValue(createInstallResult());
    const preflightSelfHostedInstallMock: Mock<PreflightSelfHostedInstall> = vi
      .fn<PreflightSelfHostedInstall>()
      .mockRejectedValue(
        new InstallPublicPortOccupiedError({
          label: 'Public HTTP port',
          optionName: '--public-http-port',
          port: 80,
        }),
      );
    vi.doMock(
      '../src/install',
      (): {
        installDev: Mock<InstallDev>;
        installSelfHosted: Mock<InstallSelfHosted>;
        preflightSelfHostedInstall: Mock<PreflightSelfHostedInstall>;
      } => ({
        installDev: vi.fn<InstallDev>(),
        installSelfHosted: installSelfHostedMock,
        preflightSelfHostedInstall: preflightSelfHostedInstallMock,
      }),
    );
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end();

    const result: CliCommandResult = await runCliCommand(
      ['install', '--base-domain', 'example.com', '--email', 'admin@example.com', '--organization', 'Acme Dev'],
      capture,
    );

    expectCliFailure(
      result,
      'Public HTTP port 80 is already in use on this host. Choose a different --public-http-port.',
    );
    expect(preflightSelfHostedInstallMock).toHaveBeenCalledTimes(1);
    expect(installSelfHostedMock).not.toHaveBeenCalled();
    expect(countOccurrences(readCliStderr(capture), 'Public HTTP port [80]: ')).toBe(1);
    expect(readCliStderr(capture)).not.toContain('Admin password: ');
  });
});

function countOccurrences(input: string, value: string): number {
  return input.split(value).length - 1;
}

async function removeCreatedDirectories(): Promise<void> {
  await Promise.all(
    createdDirectories.splice(0).map(async (directory: string): Promise<void> => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
}

function restoreConfigDirectoryEnv(): void {
  if (originalCompartmentCliConfigDir === undefined) {
    delete process.env.COMPARTMENT_CLI_CONFIG_DIR;
    return;
  }

  process.env.COMPARTMENT_CLI_CONFIG_DIR = originalCompartmentCliConfigDir;
}

function createInstallResult(): SelfHostedInstallResult {
  return {
    adminEmail: 'admin@example.com',
    apiUrl: 'http://127.0.0.1:9443',
    baseDomain: 'localhost',
    configDir: '/tmp/compartment-install/etc',
    dataDir: '/tmp/compartment-install/var',
    dnsRecords: [
      {
        host: '*.localhost',
        purpose: 'Apps',
        type: 'A/AAAA-or-CNAME',
      },
    ],
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
    compartmentUrl: 'http://console.localhost:9443',
    sessionToken: 'session_123',
  };
}
