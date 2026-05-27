import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createInstallCommandProgress } from '../src/commands/install/install.command.progress';
import type { InstallCommandProgress } from '../src/commands/install/install.command.progress.types';
import type { InstallCommandOptions } from '../src/commands/install/install.command.types';
import type { InstallInput } from '../src/services/install.service.types';
import type {
  SelfHostedInstallInput,
  SelfHostedInstallPreflightInput,
  SelfHostedInstallResult,
} from '../src/install.types';
import type { CliIo } from '../src/app.types';
import {
  createCliCapture,
  expectCliSuccess,
  readCliStderr,
  readCliStdout,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  type CliCommandCapture,
  type CliCommandResult,
} from './cli-test.harness';

type AssertNodeAgentHostServiceInstallable = () => void;
type InstallDev = (input: Omit<InstallInput, 'baseDomain'>) => Promise<SelfHostedInstallResult>;
type InstallSelfHosted = (input: SelfHostedInstallInput) => Promise<SelfHostedInstallResult>;
type PreflightSelfHostedInstall = (input: SelfHostedInstallPreflightInput) => Promise<void>;
type PromptNewPassword = (io: CliIo) => Promise<string>;
type PromptRegisterEmail = (io: CliIo, initialEmail: string | undefined) => Promise<string>;
type PromptRegisterOrganization = (
  io: CliIo,
  adminEmail: string,
  initialOrganization: string | undefined,
) => Promise<string>;
type RerunSelfHostedInstallCommandWithSudoIfNeeded = () => Promise<SelfHostedInstallResult | undefined>;

interface MockInstallCommandProgressInput {
  preflightProgressMessage: string;
  runtimeProgressMessage: string;
}

describe('install command progress', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
    restoreCliCommandModules([
      '../src/install',
      '../src/node-agent-service',
      '../src/commands/install/install.command.sudo',
      '../src/prompts/prompt',
    ]);
  });

  it('renders and clears a spinner for text TTY output', (): void => {
    vi.useFakeTimers();
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: true });
    const progress: InstallCommandProgress = createInstallCommandProgress({
      io: capture.io,
      options: createInstallCommandOptions('text'),
    });

    progress.report('Preparing self-hosted install environment...');
    vi.advanceTimersByTime(120);
    progress.stop();
    const stoppedOutput: string = readCliStderr(capture);
    vi.advanceTimersByTime(30);

    expect(stoppedOutput).toContain('- Preparing self-hosted install environment...');
    expect(stoppedOutput).toContain('\\ Preparing self-hosted install environment...');
    expect(stoppedOutput.endsWith('\r\u001B[2K')).toBe(true);
    expect(readCliStderr(capture)).toBe(stoppedOutput);
  });

  it('renders line progress for redirected text output', (): void => {
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: false });
    const progress: InstallCommandProgress = createInstallCommandProgress({
      io: capture.io,
      options: createInstallCommandOptions('text'),
    });

    progress.report('Validating install prerequisites...');
    progress.stop();

    expect(readCliStderr(capture)).toBe('Validating install prerequisites...\n');
  });

  it('does not render progress for json output', (): void => {
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: true });
    const progress: InstallCommandProgress = createInstallCommandProgress({
      io: capture.io,
      options: createInstallCommandOptions('json'),
    });

    progress.report('Validating install prerequisites...');
    progress.stop();

    expect(readCliStderr(capture)).toBe('');
  });

  it('renders progress for internal install result json output', (): void => {
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: false });
    const progress: InstallCommandProgress = createInstallCommandProgress({
      io: capture.io,
      options: createInstallCommandOptions('json', true),
    });

    progress.report('Starting self-hosted runtime...');
    progress.stop();

    expect(readCliStderr(capture)).toBe('Starting self-hosted runtime...\n');
  });

  it('suppresses install command progress for json output', async (): Promise<void> => {
    mockInstallCommandProgress({
      preflightProgressMessage: 'Preflight progress should not render.',
      runtimeProgressMessage: 'Runtime progress should not render.',
    });
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });

    const result: CliCommandResult = await runCliCommand(
      [
        'install',
        '--base-domain',
        'example.com',
        '--email',
        'admin@example.com',
        '--organization',
        'Acme Dev',
        '--output',
        'json',
        '--skip-session-persist',
      ],
      capture,
    );

    expectCliSuccess(result);
    expect(readCliStderr(capture)).toBe('');
    expect(JSON.parse(readCliStdout(capture))).toMatchObject({
      adminEmail: 'admin@example.com',
      baseDomain: 'localhost',
    });
  });

  it('renders install command progress for internal install result json output', async (): Promise<void> => {
    mockInstallCommandProgress({
      preflightProgressMessage: 'Preflight progress should render.',
      runtimeProgressMessage: 'Runtime progress should render.',
    });
    const capture: CliCommandCapture = createCliCapture({ isTTY: true, stderrIsTTY: false });

    const result: CliCommandResult = await runCliCommand(
      [
        'install',
        '--base-domain',
        'example.com',
        '--email',
        'admin@example.com',
        '--organization',
        'Acme Dev',
        '--output',
        'json',
        '--skip-session-persist',
        '--internal-install-result',
      ],
      capture,
    );

    expectCliSuccess(result);
    const stderr: string = readCliStderr(capture);
    expect(stderr).toContain('Preflight progress should render.\n');
    expect(stderr).toContain('Using published self-hosted image tag');
    expect(stderr).toContain('Runtime progress should render.\n');
    expect(JSON.parse(readCliStdout(capture))).toMatchObject({
      adminEmail: 'admin@example.com',
      baseDomain: 'localhost',
    });
  });
});

function createInstallCommandOptions(
  output: 'json' | 'text',
  internalInstallResult: boolean = false,
): InstallCommandOptions {
  return {
    ...(internalInstallResult ? { internalInstallResult: true } : {}),
    output,
  };
}

function mockInstallCommandProgress(input: MockInstallCommandProgressInput): void {
  resetCliCommandModules();
  vi.doMock(
    '../src/install',
    (): {
      installDev: Mock<InstallDev>;
      installSelfHosted: Mock<InstallSelfHosted>;
      preflightSelfHostedInstall: Mock<PreflightSelfHostedInstall>;
    } => ({
      installDev: vi.fn<InstallDev>(),
      installSelfHosted: vi
        .fn<InstallSelfHosted>()
        .mockImplementation(async (installInput: SelfHostedInstallInput): Promise<SelfHostedInstallResult> => {
          installInput.context?.reportProgress?.(input.runtimeProgressMessage);
          await Promise.resolve();
          return createInstallResult();
        }),
      preflightSelfHostedInstall: vi
        .fn<PreflightSelfHostedInstall>()
        .mockImplementation(async (installInput: SelfHostedInstallPreflightInput): Promise<void> => {
          installInput.context?.reportProgress?.(input.preflightProgressMessage);
          await Promise.resolve();
        }),
    }),
  );
  vi.doMock(
    '../src/node-agent-service',
    (): { assertNodeAgentHostServiceInstallable: Mock<AssertNodeAgentHostServiceInstallable> } => ({
      assertNodeAgentHostServiceInstallable: vi.fn<AssertNodeAgentHostServiceInstallable>(),
    }),
  );
  vi.doMock(
    '../src/commands/install/install.command.sudo',
    (): {
      rerunSelfHostedInstallCommandWithSudoIfNeeded: Mock<RerunSelfHostedInstallCommandWithSudoIfNeeded>;
    } => ({
      rerunSelfHostedInstallCommandWithSudoIfNeeded: vi
        .fn<RerunSelfHostedInstallCommandWithSudoIfNeeded>()
        .mockResolvedValue(undefined),
    }),
  );
  vi.doMock(
    '../src/prompts/prompt',
    (): {
      promptNewPassword: Mock<PromptNewPassword>;
      promptRegisterEmail: Mock<PromptRegisterEmail>;
      promptRegisterOrganization: Mock<PromptRegisterOrganization>;
    } => ({
      promptNewPassword: vi.fn<PromptNewPassword>().mockResolvedValue('supersecretpassword'),
      promptRegisterEmail: vi.fn<PromptRegisterEmail>().mockResolvedValue('admin@example.com'),
      promptRegisterOrganization: vi.fn<PromptRegisterOrganization>().mockResolvedValue('Acme Dev'),
    }),
  );
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
