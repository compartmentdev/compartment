import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { arch, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type * as CliBuildInfoModule from '../src/cli-build-info';
import type * as SelfHostedSudoRerunModule from '../src/self-hosted-sudo-rerun';
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
import { createInstallCommandResultFixture as createInstallResult } from './install.command.fixtures';
import type { ManagedDomainAllocationMetadata, ManagedDomainAllocationResponse } from '@compartment/contracts';
import { readCliVersion } from '../src/cli-build-info';
import type { CliIo } from '../src/app.types';
import type {
  SelfHostedInstallInput,
  SelfHostedInstallPreflightInput,
  SelfHostedInstallResult,
} from '../src/install.types';
import type { InstallInput } from '../src/services/install.service.types';
import type { CliBuildInfo } from '../src/cli-build-info.types';

interface AllocateInstallManagedDomainInput {
  brokerUrl: string;
  installationId: string;
  metadata: ManagedDomainAllocationMetadata;
  publicIp: string;
  requestedLabelSource: string;
}

type AllocateInstallManagedDomain = (
  input: AllocateInstallManagedDomainInput,
) => Promise<ManagedDomainAllocationResponse>;
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
type ImportOriginalCliBuildInfo = () => Promise<typeof CliBuildInfoModule>;
type ReadCliBuildInfo = () => CliBuildInfo;
type ReadPublicIpAddress = () => Promise<string>;
type RerunSelfHostedCommandWithSudoIfNeeded = typeof SelfHostedSudoRerunModule.rerunSelfHostedCommandWithSudoIfNeeded;
type AssertNodeAgentHostServiceInstallable = () => void;

const originalCompartmentCliConfigDir: string | undefined = process.env.COMPARTMENT_CLI_CONFIG_DIR;
const originalNoColor: string | undefined = process.env.NO_COLOR;
const createdDirectories: string[] = [];
const nodeAgentServiceMocks: {
  assertNodeAgentHostServiceInstallable: Mock<AssertNodeAgentHostServiceInstallable>;
} = vi.hoisted(
  (): {
    assertNodeAgentHostServiceInstallable: Mock<AssertNodeAgentHostServiceInstallable>;
  } => ({
    assertNodeAgentHostServiceInstallable: vi.fn<AssertNodeAgentHostServiceInstallable>(),
  }),
);

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
    assertNodeAgentHostServiceInstallable: nodeAgentServiceMocks.assertNodeAgentHostServiceInstallable,
  }),
);

describe.sequential('compartment install command boundary validation', (): void => {
  beforeEach((): void => {
    nodeAgentServiceMocks.assertNodeAgentHostServiceInstallable.mockReset();
  });

  afterEach(async (): Promise<void> => {
    restoreConfigDirectoryEnv();
    restoreNoColorEnv();
    await removeCreatedDirectories();
    restoreCliCommandModules([
      '../src/install',
      '../src/cli-build-info',
      '../src/prompts/prompt',
      '../src/public-ip',
      '../src/services/managed-domain.service',
    ]);
  });

  it('allows combining local images with an explicit version and reaches preflight', async (): Promise<void> => {
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
          .mockRejectedValue(new Error('Local version preflight reached.')),
      }),
    );
    const capture: CliCommandCapture = createCliCapture({
      isTTY: true,
    });
    capture.stdin.end('\n\n');

    const result: CliCommandResult = await runCliCommand(
      [
        'install',
        '--image-source',
        'local',
        '--version',
        'main',
        '--email',
        'admin@example.com',
        '--organization',
        'Acme Dev',
      ],
      capture,
    );

    expectCliFailure(result, 'Local version preflight reached.');
    expect(readCliStderr(capture)).not.toContain('Admin password: ');
    expect(readCliStderr(capture)).not.toContain('Confirm password: ');
  });

  it('rejects combining dev mode with packaged runtime flags', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(['install', '--dev', '--local-runtime']);

    expectCliFailure(result, '`--dev` cannot be combined with `--local-runtime`.');
  });

  it('rejects combining dev mode with explicit image registry selection', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(['install', '--dev', '--image-registry', 'docker-hub']);

    expectCliFailure(result, '`--dev` cannot be combined with `--image-registry`.');
  });

  it('rejects --remote without --dev', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(['install', '--remote', 'lab-dev']);

    expectCliFailure(result, '`--remote` requires `--dev`.');
  });

  it('rejects combining managed domains with an explicit base domain', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand([
      'install',
      '--managed-domain',
      '--base-domain',
      'example.com',
    ]);

    expectCliFailure(result, '`--managed-domain` cannot be combined with `--base-domain`.');
  });

  it('rejects invalid explicit organization slugs before install work starts', async (): Promise<void> => {
    const allocateInstallManagedDomainMock: Mock<AllocateInstallManagedDomain> = vi
      .fn<AllocateInstallManagedDomain>()
      .mockResolvedValue(createManagedDomainAllocationResponse());
    const promptRegisterEmailMock: Mock<PromptRegisterEmail> = vi
      .fn<PromptRegisterEmail>()
      .mockResolvedValue('admin@example.com');
    const promptRegisterOrganizationMock: Mock<PromptRegisterOrganization> = vi
      .fn<PromptRegisterOrganization>()
      .mockResolvedValue('Acme Dev');
    const readPublicIpAddressMock: Mock<ReadPublicIpAddress> = vi
      .fn<ReadPublicIpAddress>()
      .mockResolvedValue('203.0.113.10');
    resetCliCommandModules();
    vi.doMock(
      '../src/prompts/prompt',
      (): {
        promptNewPassword: Mock<PromptNewPassword>;
        promptRegisterEmail: Mock<PromptRegisterEmail>;
        promptRegisterOrganization: Mock<PromptRegisterOrganization>;
      } => ({
        promptNewPassword: vi.fn<PromptNewPassword>().mockResolvedValue('supersecretpassword'),
        promptRegisterEmail: promptRegisterEmailMock,
        promptRegisterOrganization: promptRegisterOrganizationMock,
      }),
    );
    vi.doMock(
      '../src/public-ip',
      (): {
        readPublicIpAddress: Mock<ReadPublicIpAddress>;
      } => ({
        readPublicIpAddress: readPublicIpAddressMock,
      }),
    );
    vi.doMock(
      '../src/services/managed-domain.service',
      (): {
        allocateInstallManagedDomain: Mock<AllocateInstallManagedDomain>;
      } => ({
        allocateInstallManagedDomain: allocateInstallManagedDomainMock,
      }),
    );

    const result: CliCommandResult = await runCliCommand(['install', '--organization-slug', 'Hello World']);

    expectCliFailure(result, 'Organization slug must use lowercase letters, digits, and single hyphens.');
    expect(promptRegisterEmailMock).not.toHaveBeenCalled();
    expect(promptRegisterOrganizationMock).not.toHaveBeenCalled();
    expect(readPublicIpAddressMock).not.toHaveBeenCalled();
    expect(allocateInstallManagedDomainMock).not.toHaveBeenCalled();
  });

  it('rejects organization names that cannot produce a slug before broker allocation', async (): Promise<void> => {
    const allocateInstallManagedDomainMock: Mock<AllocateInstallManagedDomain> = vi
      .fn<AllocateInstallManagedDomain>()
      .mockResolvedValue(createManagedDomainAllocationResponse());
    const installSelfHostedMock: Mock<InstallSelfHosted> = vi
      .fn<InstallSelfHosted>()
      .mockResolvedValue(createInstallResult());
    const promptRegisterEmailMock: Mock<PromptRegisterEmail> = vi
      .fn<PromptRegisterEmail>()
      .mockResolvedValue('admin@example.com');
    const promptRegisterOrganizationMock: Mock<PromptRegisterOrganization> = vi
      .fn<PromptRegisterOrganization>()
      .mockResolvedValue('!!!');
    const promptNewPasswordMock: Mock<PromptNewPassword> = vi
      .fn<PromptNewPassword>()
      .mockResolvedValue('supersecretpassword');
    const readPublicIpAddressMock: Mock<ReadPublicIpAddress> = vi
      .fn<ReadPublicIpAddress>()
      .mockResolvedValue('203.0.113.10');
    resetCliCommandModules();
    vi.doMock(
      '../src/install',
      (): {
        installDev: Mock<InstallDev>;
        installSelfHosted: Mock<InstallSelfHosted>;
        preflightSelfHostedInstall: Mock<PreflightSelfHostedInstall>;
      } => ({
        installDev: vi.fn<InstallDev>(),
        installSelfHosted: installSelfHostedMock,
        preflightSelfHostedInstall: vi.fn<PreflightSelfHostedInstall>().mockResolvedValue(undefined),
      }),
    );
    vi.doMock(
      '../src/prompts/prompt',
      (): {
        promptNewPassword: Mock<PromptNewPassword>;
        promptRegisterEmail: Mock<PromptRegisterEmail>;
        promptRegisterOrganization: Mock<PromptRegisterOrganization>;
      } => ({
        promptNewPassword: promptNewPasswordMock,
        promptRegisterEmail: promptRegisterEmailMock,
        promptRegisterOrganization: promptRegisterOrganizationMock,
      }),
    );
    vi.doMock(
      '../src/public-ip',
      (): {
        readPublicIpAddress: Mock<ReadPublicIpAddress>;
      } => ({
        readPublicIpAddress: readPublicIpAddressMock,
      }),
    );
    vi.doMock(
      '../src/services/managed-domain.service',
      (): {
        allocateInstallManagedDomain: Mock<AllocateInstallManagedDomain>;
      } => ({
        allocateInstallManagedDomain: allocateInstallManagedDomainMock,
      }),
    );

    const result: CliCommandResult = await runCliCommand([
      'install',
      '--email',
      'admin@example.com',
      '--organization',
      '!!!',
      '--public-http-port',
      '80',
      '--public-https-port',
      '443',
    ]);

    expectCliFailure(result, 'Organization slug must contain at least one letter or digit.');
    expect(promptRegisterEmailMock).toHaveBeenCalled();
    expect(promptRegisterOrganizationMock).toHaveBeenCalled();
    expect(promptNewPasswordMock).toHaveBeenCalled();
    expect(readPublicIpAddressMock).not.toHaveBeenCalled();
    expect(allocateInstallManagedDomainMock).not.toHaveBeenCalled();
    expect(installSelfHostedMock).not.toHaveBeenCalled();
  });

  it('rejects removed custom install path flags', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(['install', '--config-dir', '/tmp/compartment/etc']);

    expectCliFailure(result, "unknown option '--config-dir'");
  });

  it('rejects invalid published version selectors', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(['install', '--version', 'broken']);

    expectCliFailure(
      result,
      'Install version must be `latest`, `main`, `sha-<commit>`, or an exact release like `0.2.0`.',
    );
  });

  it('rejects registry install versions that do not match the packaged node agent binary', async (): Promise<void> => {
    const sudoRerunModule: typeof SelfHostedSudoRerunModule = await import('../src/self-hosted-sudo-rerun');
    const rerunMock: Mock<RerunSelfHostedCommandWithSudoIfNeeded> = vi.mocked(
      sudoRerunModule.rerunSelfHostedCommandWithSudoIfNeeded,
    );
    rerunMock.mockClear();

    const result: CliCommandResult = await runCliCommand(['install', '--version', '9.9.9']);

    expectCliFailure(
      result,
      'Host node-agent must come from the same packaged compartment CLI as the selected runtime version.',
    );
    expect(rerunMock).not.toHaveBeenCalled();
  });

  it('rejects non-packaged self-hosted installs before sudo rerun', async (): Promise<void> => {
    const sudoRerunModule: typeof SelfHostedSudoRerunModule = await import('../src/self-hosted-sudo-rerun');
    const rerunMock: Mock<RerunSelfHostedCommandWithSudoIfNeeded> = vi.mocked(
      sudoRerunModule.rerunSelfHostedCommandWithSudoIfNeeded,
    );
    rerunMock.mockClear();
    nodeAgentServiceMocks.assertNodeAgentHostServiceInstallable.mockImplementationOnce((): never => {
      throw new Error('compartment-node-agent can only be installed from the self-contained compartment binary.');
    });

    const result: CliCommandResult = await runCliCommand(['install']);

    expectCliFailure(
      result,
      'compartment-node-agent can only be installed from the self-contained compartment binary.',
    );
    expect(rerunMock).not.toHaveBeenCalled();
  });

  it('rejects unknown install image sources', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(['install', '--image-source', 'broken']);

    expectCliFailure(result, 'Install image source must be `registry` or `local` when provided.');
  });

  it('rejects unknown install image registries', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(['install', '--image-registry', 'broken']);

    expectCliFailure(result, 'Self-hosted image registry must be `github` or `docker-hub` when provided.');
  });

  it('fails on self-hosted preflight before prompting for the admin password', async (): Promise<void> => {
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
          .mockRejectedValue(new Error('Docker is required for self-hosted install.')),
      }),
    );
    const capture: CliCommandCapture = createCliCapture({
      isTTY: true,
    });
    capture.stdin.end('supersecretpassword\nsupersecretpassword\n');

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

    expectCliFailure(result, 'Docker is required for self-hosted install.');
    expect(readCliStderr(capture)).not.toContain('Admin password: ');
    expect(readCliStderr(capture)).not.toContain('Confirm password: ');
  });

  it('persists the first admin session and prints local login instructions after sudo setup succeeds', async (): Promise<void> => {
    const configDirectory: string = await createTempDirectory('compartment-cli-install-session-');
    const sudoRerunModule: typeof SelfHostedSudoRerunModule = await import('../src/self-hosted-sudo-rerun');
    const rerunMock: Mock<RerunSelfHostedCommandWithSudoIfNeeded> = vi.mocked(
      sudoRerunModule.rerunSelfHostedCommandWithSudoIfNeeded,
    );

    process.env.COMPARTMENT_CLI_CONFIG_DIR = configDirectory;
    delete process.env.NO_COLOR;
    rerunMock.mockResolvedValueOnce({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify(createInstallResult()),
    });

    const capture: CliCommandCapture = createCliCapture({
      isTTY: true,
    });

    const result: CliCommandResult = await runCliCommand(['install'], capture);

    expectCliSuccess(result);
    const stdout: string = result.capture.stdout.join('');
    const plainStdout: string = stripAnsi(stdout);
    const logoIndex: number = stdout.indexOf('⠀⠀⠀⣠⣴⡆⣶⣦⣄⠠⣴⣾⣷⣦⠄⠀⠀⠀');
    const welcomeIndex: number = stdout.indexOf('Welcome to Compartment');
    const installedOnServerIndex: number = stdout.indexOf('Installed on this server:');
    const continueSetupIndex: number = plainStdout.indexOf('Continue setup here:');
    expect(logoIndex).toBeGreaterThanOrEqual(0);
    expect(welcomeIndex).toBeGreaterThan(logoIndex);
    expect(installedOnServerIndex).toBeGreaterThan(welcomeIndex);
    expect(continueSetupIndex).toBeGreaterThan(installedOnServerIndex);
    expect(stdout).toContain('⣬⣛⠿⠿⠛⠁⣬⣛⠿⠿⣛⣥⠀⠀⠀⢸⣿⣷    Welcome to Compartment');
    expect(stdout).toContain('⠀⠀⠀⠐⠻⢿⡿⠟⠂⠙⠻⠿⠸⠟⠋⠀⠀⠀\n\nInstalled on this server:');
    expect(stdout).not.toContain('------------------------------------------------------------');
    expect(stdout).not.toContain('Compartment install complete');
    expect(stdout).not.toBe(plainStdout);
    expect(stdout).toContain('http://console.localhost:9443/login?email=admin%40example.com');
    expect(stdout).toContain('Installed on this server:');
    expect(stdout).toContain('CLI session: Logged in as admin@example.com.');
    expect(stdout).toContain(
      'compartment login --api-url http://127.0.0.1:9443 --email admin@example.com --organization acme-dev',
    );
    expect(stdout).not.toContain('Optional repo setup for AI agents:');
    expect(stdout).not.toContain('Run `compartment skill install` inside an app repository.');
    expect(stdout).toContain(
      'curl -fsSL https://compartment.dev/install.sh | sh -s -- --init-login --api-url http://127.0.0.1:9443 --email admin@example.com --organization acme-dev',
    );
    await expect(readFile(join(configDirectory, 'config.json'), 'utf8')).resolves.toContain(
      '"sessionToken": "session_123"',
    );
  });

  it('prints the full install output for dev installs', async (): Promise<void> => {
    const configDirectory: string = await createTempDirectory('compartment-cli-dev-install-session-');

    process.env.COMPARTMENT_CLI_CONFIG_DIR = configDirectory;
    resetCliCommandModules();
    vi.doMock(
      '../src/install',
      (): {
        installDev: Mock<InstallDev>;
        installSelfHosted: Mock<InstallSelfHosted>;
        preflightSelfHostedInstall: Mock<PreflightSelfHostedInstall>;
      } => ({
        installDev: vi.fn<InstallDev>().mockResolvedValue(createInstallResult()),
        installSelfHosted: vi.fn<InstallSelfHosted>(),
        preflightSelfHostedInstall: vi.fn<PreflightSelfHostedInstall>(),
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

    const result: CliCommandResult = await runCliCommand([
      'install',
      '--dev',
      '--email',
      'admin@example.com',
      '--organization',
      'Acme Dev',
    ]);

    expectCliSuccess(result);
    const stdout: string = result.capture.stdout.join('');
    expect(stdout).toContain('Welcome to Compartment');
    expect(stdout).toContain('Continue setup here:');
    expect(stdout).toContain('http://console.localhost:9443/login?email=admin%40example.com');
    expect(stdout).toContain('Installed on this server:');
    expect(stdout).toContain('CLI session: Logged in as admin@example.com.');
    expect(stdout).toContain('Alternatively, install the CLI on this server and log in to this runtime:');
    expect(stdout).not.toContain('Optional repo setup for AI agents:');
    expect(stdout).not.toContain('Run `compartment skill install` inside an app repository.');
    expect(stdout).not.toContain('\u001B[');
    expect(stdout).not.toContain('Installed compartment at ');
  });

  it('quotes shell-sensitive values in local login instructions after sudo setup succeeds', async (): Promise<void> => {
    const configDirectory: string = await createTempDirectory('compartment-cli-install-session-');
    const sudoRerunModule: typeof SelfHostedSudoRerunModule = await import('../src/self-hosted-sudo-rerun');
    const rerunMock: Mock<RerunSelfHostedCommandWithSudoIfNeeded> = vi.mocked(
      sudoRerunModule.rerunSelfHostedCommandWithSudoIfNeeded,
    );
    const installResult: SelfHostedInstallResult = {
      ...createInstallResult(),
      adminEmail: "o'hara@example.com",
    };
    const shellQuotedEmail: string = "'o'\\''hara@example.com'";

    process.env.COMPARTMENT_CLI_CONFIG_DIR = configDirectory;
    rerunMock.mockResolvedValueOnce({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify(installResult),
    });

    const result: CliCommandResult = await runCliCommand(['install']);

    expectCliSuccess(result);
    const stdout: string = result.capture.stdout.join('');
    expect(stdout).toContain(
      `compartment login --api-url http://127.0.0.1:9443 --email ${shellQuotedEmail} --organization acme-dev`,
    );
    expect(stdout).toContain(
      `curl -fsSL https://compartment.dev/install.sh | sh -s -- --init-login --api-url http://127.0.0.1:9443 --email ${shellQuotedEmail} --organization acme-dev`,
    );
  });

  it('stops when sudo setup fails before running local install work', async (): Promise<void> => {
    const sudoRerunModule: typeof SelfHostedSudoRerunModule = await import('../src/self-hosted-sudo-rerun');
    const rerunMock: Mock<RerunSelfHostedCommandWithSudoIfNeeded> = vi.mocked(
      sudoRerunModule.rerunSelfHostedCommandWithSudoIfNeeded,
    );
    const installSelfHostedMock: Mock<InstallSelfHosted> = vi
      .fn<InstallSelfHosted>()
      .mockResolvedValue(createInstallResult());
    resetCliCommandModules();
    vi.doMock(
      '../src/install',
      (): {
        installDev: Mock<InstallDev>;
        installSelfHosted: Mock<InstallSelfHosted>;
        preflightSelfHostedInstall: Mock<PreflightSelfHostedInstall>;
      } => ({
        installDev: vi.fn<InstallDev>(),
        installSelfHosted: installSelfHostedMock,
        preflightSelfHostedInstall: vi.fn<PreflightSelfHostedInstall>().mockResolvedValue(undefined),
      }),
    );
    rerunMock.mockResolvedValueOnce({
      exitCode: 42,
      stderr: '',
      stdout: '',
    });

    const result: CliCommandResult = await runCliCommand(['install']);

    expect(result.exitCode).toBe(42);
    expect(installSelfHostedMock).not.toHaveBeenCalled();
  });

  it('surfaces sudo rerun setup errors before prompting for install details', async (): Promise<void> => {
    const sudoRerunModule: typeof SelfHostedSudoRerunModule = await import('../src/self-hosted-sudo-rerun');
    const rerunMock: Mock<RerunSelfHostedCommandWithSudoIfNeeded> = vi.mocked(
      sudoRerunModule.rerunSelfHostedCommandWithSudoIfNeeded,
    );
    const capture: CliCommandCapture = createCliCapture();
    rerunMock.mockRejectedValueOnce(
      new Error(
        'System self-hosted install uses /etc/compartment and /var/lib/compartment. Run `/home/user/.local/bin/compartment install` from an interactive shell.',
      ),
    );

    const result: CliCommandResult = await runCliCommand(['install'], capture);

    expectCliFailure(
      result,
      'System self-hosted install uses /etc/compartment and /var/lib/compartment. Run `/home/user/.local/bin/compartment install` from an interactive shell.',
    );
    expect(readCliStderr(capture)).not.toContain('Admin email: ');
    expect(readCliStderr(capture)).not.toContain('Admin password: ');
  });

  it('allocates a managed domain by default and passes broker metadata to installSelfHosted', async (): Promise<void> => {
    const allocateInstallManagedDomainMock: Mock<AllocateInstallManagedDomain> = vi
      .fn<AllocateInstallManagedDomain>()
      .mockResolvedValue(createManagedDomainAllocationResponse());
    const installSelfHostedMock: Mock<InstallSelfHosted> = vi
      .fn<InstallSelfHosted>()
      .mockResolvedValue(createInstallResult());
    resetCliCommandModules();
    vi.doMock(
      '../src/install',
      (): {
        installDev: Mock<InstallDev>;
        installSelfHosted: Mock<InstallSelfHosted>;
        preflightSelfHostedInstall: Mock<PreflightSelfHostedInstall>;
      } => ({
        installDev: vi.fn<InstallDev>(),
        installSelfHosted: installSelfHostedMock,
        preflightSelfHostedInstall: vi.fn<PreflightSelfHostedInstall>().mockResolvedValue(undefined),
      }),
    );
    vi.doMock(
      '../src/public-ip',
      (): {
        readPublicIpAddress: Mock<ReadPublicIpAddress>;
      } => ({
        readPublicIpAddress: vi.fn<ReadPublicIpAddress>().mockResolvedValue('203.0.113.10'),
      }),
    );
    vi.doMock(
      '../src/services/managed-domain.service',
      (): {
        allocateInstallManagedDomain: Mock<AllocateInstallManagedDomain>;
      } => ({
        allocateInstallManagedDomain: allocateInstallManagedDomainMock,
      }),
    );
    const capture: CliCommandCapture = createCliCapture({
      isTTY: true,
    });
    capture.stdin.end('supersecretpassword\nsupersecretpassword\n');

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

    expectCliSuccess(result);
    const firstAllocationInput: AllocateInstallManagedDomainInput | undefined =
      allocateInstallManagedDomainMock.mock.calls[0]?.[0];
    expect(firstAllocationInput).toBeDefined();
    expect(firstAllocationInput?.brokerUrl).toBe('https://broker.compartment.run');
    expect(firstAllocationInput?.publicIp).toBe('203.0.113.10');
    expect(firstAllocationInput?.metadata).toEqual({
      cliVersion: readCliVersion(),
      os: {
        arch: arch(),
        platform: platform(),
        release: release(),
      },
      runtimeVersion: 'latest',
    });
    expect(firstAllocationInput?.installationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    const firstInstallSelfHostedInput: SelfHostedInstallInput | undefined = installSelfHostedMock.mock.calls[0]?.[0];
    expect(firstInstallSelfHostedInput).toBeDefined();
    expect(firstInstallSelfHostedInput?.options.baseDomain).toBe('4h8z9k2m1p7q.app.compartment.run');
    expect(firstInstallSelfHostedInput?.options.installationId).toBe(firstAllocationInput?.installationId);
    expect(firstInstallSelfHostedInput?.options.publicIngressIpv4).toBe('203.0.113.10');
    expect(firstInstallSelfHostedInput?.options.publicIngressIpv6).toBe('');
    expect(firstInstallSelfHostedInput?.options.managedDomain).toEqual({
      acmeEmail: 'admin@example.com',
      baseDomain: '4h8z9k2m1p7q.app.compartment.run',
      brokerUrl: 'https://broker.compartment.run',
      managedDomainBrokerToken: 'acme-token',
    });
  });

  it('stores a detected managed IPv6 ingress in the IPv6 env slot', async (): Promise<void> => {
    const allocateInstallManagedDomainMock: Mock<AllocateInstallManagedDomain> = vi
      .fn<AllocateInstallManagedDomain>()
      .mockResolvedValue(createManagedDomainAllocationResponse());
    const installSelfHostedMock: Mock<InstallSelfHosted> = vi
      .fn<InstallSelfHosted>()
      .mockResolvedValue(createInstallResult());
    resetCliCommandModules();
    vi.doMock(
      '../src/install',
      (): {
        installDev: Mock<InstallDev>;
        installSelfHosted: Mock<InstallSelfHosted>;
        preflightSelfHostedInstall: Mock<PreflightSelfHostedInstall>;
      } => ({
        installDev: vi.fn<InstallDev>(),
        installSelfHosted: installSelfHostedMock,
        preflightSelfHostedInstall: vi.fn<PreflightSelfHostedInstall>().mockResolvedValue(undefined),
      }),
    );
    vi.doMock(
      '../src/public-ip',
      (): {
        readPublicIpAddress: Mock<ReadPublicIpAddress>;
      } => ({
        readPublicIpAddress: vi.fn<ReadPublicIpAddress>().mockResolvedValue('2001:db8::10'),
      }),
    );
    vi.doMock(
      '../src/services/managed-domain.service',
      (): {
        allocateInstallManagedDomain: Mock<AllocateInstallManagedDomain>;
      } => ({
        allocateInstallManagedDomain: allocateInstallManagedDomainMock,
      }),
    );
    const capture: CliCommandCapture = createCliCapture({
      isTTY: true,
    });
    capture.stdin.end('supersecretpassword\nsupersecretpassword\n');

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

    expectCliSuccess(result);
    const installSelfHostedInput: SelfHostedInstallInput | undefined = installSelfHostedMock.mock.calls[0]?.[0];
    expect(installSelfHostedInput?.options.publicIngressIpv4).toBe('');
    expect(installSelfHostedInput?.options.publicIngressIpv6).toBe('2001:db8::10');
    expect(allocateInstallManagedDomainMock.mock.calls[0]?.[0].publicIp).toBe('2001:db8::10');
  });

  it('does not allocate a managed domain when identity prompts fail', async (): Promise<void> => {
    const allocateInstallManagedDomainMock: Mock<AllocateInstallManagedDomain> = vi
      .fn<AllocateInstallManagedDomain>()
      .mockResolvedValue(createManagedDomainAllocationResponse());
    const installSelfHostedMock: Mock<InstallSelfHosted> = vi
      .fn<InstallSelfHosted>()
      .mockResolvedValue(createInstallResult());
    const promptRegisterEmailMock: Mock<PromptRegisterEmail> = vi
      .fn<PromptRegisterEmail>()
      .mockResolvedValue('admin@example.com');
    const promptRegisterOrganizationMock: Mock<PromptRegisterOrganization> = vi
      .fn<PromptRegisterOrganization>()
      .mockResolvedValue('Acme Dev');
    const promptNewPasswordMock: Mock<PromptNewPassword> = vi
      .fn<PromptNewPassword>()
      .mockRejectedValue(new Error('Prompt aborted.'));
    const readPublicIpAddressMock: Mock<ReadPublicIpAddress> = vi
      .fn<ReadPublicIpAddress>()
      .mockResolvedValue('203.0.113.10');

    resetCliCommandModules();
    vi.doMock(
      '../src/install',
      (): {
        installDev: Mock<InstallDev>;
        installSelfHosted: Mock<InstallSelfHosted>;
        preflightSelfHostedInstall: Mock<PreflightSelfHostedInstall>;
      } => ({
        installDev: vi.fn<InstallDev>(),
        installSelfHosted: installSelfHostedMock,
        preflightSelfHostedInstall: vi.fn<PreflightSelfHostedInstall>().mockResolvedValue(undefined),
      }),
    );
    vi.doMock(
      '../src/prompts/prompt',
      (): {
        promptNewPassword: Mock<PromptNewPassword>;
        promptRegisterEmail: Mock<PromptRegisterEmail>;
        promptRegisterOrganization: Mock<PromptRegisterOrganization>;
      } => ({
        promptNewPassword: promptNewPasswordMock,
        promptRegisterEmail: promptRegisterEmailMock,
        promptRegisterOrganization: promptRegisterOrganizationMock,
      }),
    );
    vi.doMock(
      '../src/public-ip',
      (): {
        readPublicIpAddress: Mock<ReadPublicIpAddress>;
      } => ({
        readPublicIpAddress: readPublicIpAddressMock,
      }),
    );
    vi.doMock(
      '../src/services/managed-domain.service',
      (): {
        allocateInstallManagedDomain: Mock<AllocateInstallManagedDomain>;
      } => ({
        allocateInstallManagedDomain: allocateInstallManagedDomainMock,
      }),
    );

    const result: CliCommandResult = await runCliCommand([
      'install',
      '--public-http-port',
      '80',
      '--public-https-port',
      '443',
    ]);

    expectCliFailure(result, 'Prompt aborted.');
    expect(promptRegisterEmailMock).toHaveBeenCalled();
    expect(promptRegisterOrganizationMock).toHaveBeenCalled();
    expect(promptNewPasswordMock).toHaveBeenCalled();
    expect(readPublicIpAddressMock).not.toHaveBeenCalled();
    expect(allocateInstallManagedDomainMock).not.toHaveBeenCalled();
    expect(installSelfHostedMock).not.toHaveBeenCalled();
  });

  it('does not call the managed domain broker for explicit base-domain installs', async (): Promise<void> => {
    const allocateInstallManagedDomainMock: Mock<AllocateInstallManagedDomain> = vi
      .fn<AllocateInstallManagedDomain>()
      .mockResolvedValue(createManagedDomainAllocationResponse());
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
    vi.doMock(
      '../src/services/managed-domain.service',
      (): {
        allocateInstallManagedDomain: Mock<AllocateInstallManagedDomain>;
      } => ({
        allocateInstallManagedDomain: allocateInstallManagedDomainMock,
      }),
    );
    const capture: CliCommandCapture = createCliCapture({
      isTTY: true,
    });
    capture.stdin.end('supersecretpassword\nsupersecretpassword\n');

    const result: CliCommandResult = await runCliCommand(
      [
        'install',
        '--base-domain',
        'example.com',
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

    expectCliSuccess(result);
    expect(allocateInstallManagedDomainMock).not.toHaveBeenCalled();
  });

  it('surfaces the sudo explanation when preflight reports interactive docker access', async (): Promise<void> => {
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
            input.context?.reportProgress?.(
              'Direct Docker access is unavailable. Checking Docker access via sudo; you may be prompted for your password.',
            );
            await Promise.resolve();
            throw new Error('Docker preflight stopped after reporting sudo usage.');
          }),
      }),
    );
    const capture: CliCommandCapture = createCliCapture({
      isTTY: true,
    });
    capture.stdin.end('supersecretpassword\nsupersecretpassword\n');

    const result: CliCommandResult = await runCliCommand(
      [
        'install',
        '--base-domain',
        'example.com',
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

    expectCliFailure(result, 'Docker preflight stopped after reporting sudo usage.');
    expect(readCliStderr(capture)).toContain(
      'Direct Docker access is unavailable. Checking Docker access via sudo; you may be prompted for your password.',
    );
    expect(readCliStderr(capture)).not.toContain('Admin password: ');
    expect(readCliStderr(capture)).not.toContain('Confirm password: ');
  });

  it('explains when the install defaults to the embedded main runtime tag', async (): Promise<void> => {
    resetCliCommandModules();
    vi.doMock(
      '../src/cli-build-info',
      async (importOriginal: ImportOriginalCliBuildInfo): Promise<typeof CliBuildInfoModule> => {
        const actualModule: typeof CliBuildInfoModule = await importOriginal();

        return {
          ...actualModule,
          readCliBuildInfo: vi.fn<ReadCliBuildInfo>().mockReturnValue({
            buildCommitSha: '8355ff9c8f6ca4291da56a9dfa99a8fd6c7fad2e',
            cliVersion: '0.1.0',
            defaultRegistryImageTag: 'sha-8355ff9c8f6ca4291da56a9dfa99a8fd6c7fad2e',
            distributionChannel: 'main',
          }),
        };
      },
    );
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
          .mockRejectedValue(new Error('Stopped after reporting the default main runtime tag.')),
        preflightSelfHostedInstall: vi.fn<PreflightSelfHostedInstall>().mockResolvedValue(undefined),
      }),
    );
    const capture: CliCommandCapture = createCliCapture({
      isTTY: true,
    });
    capture.stdin.end('supersecretpassword\nsupersecretpassword\n');

    const result: CliCommandResult = await runCliCommand(
      [
        'install',
        '--base-domain',
        'example.com',
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

    expectCliFailure(result, 'Stopped after reporting the default main runtime tag.');
    expect(readCliStderr(capture)).toContain(
      'Using published self-hosted image tag sha-8355ff9c8f6ca4291da56a9dfa99a8fd6c7fad2e from GitHub Container Registry because this compartment CLI was installed from the main channel.',
    );
  });
});

async function createTempDirectory(prefix: string): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), prefix));
  createdDirectories.push(directory);
  return directory;
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

function restoreNoColorEnv(): void {
  if (originalNoColor === undefined) {
    delete process.env.NO_COLOR;
    return;
  }

  process.env.NO_COLOR = originalNoColor;
}

function stripAnsi(value: string): string {
  const ansiEscape: string = String.fromCharCode(27);
  return value.replaceAll(new RegExp(`${ansiEscape}\\[[\\d;]+m`, 'g'), '');
}

function createManagedDomainAllocationResponse(): ManagedDomainAllocationResponse {
  return {
    acmeDnsToken: 'acme-token',
    baseDomain: '4h8z9k2m1p7q.app.compartment.run',
    dnsRecords: [
      {
        host: '*.4h8z9k2m1p7q.app.compartment.run',
        purpose: 'Compartment control plane and hosted application entrypoints',
        type: 'A/AAAA-or-CNAME',
      },
    ],
  };
}
