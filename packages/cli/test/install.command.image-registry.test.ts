import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createCliCapture,
  expectCliSuccess,
  readCliStderr,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  type CliCommandCapture,
  type CliCommandResult,
} from './cli-test.harness';
import { createInstallCommandResultFixture } from './install.command.fixtures';
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

describe.sequential('compartment install image registry command boundary', (): void => {
  afterEach((): void => {
    restoreCliCommandModules(['../src/install']);
  });

  it('renders the Docker Hub image source when the operator selects that registry', async (): Promise<void> => {
    resetCliCommandModules();
    vi.doMock(
      '../src/install',
      (): {
        installDev: Mock<InstallDev>;
        installSelfHosted: Mock<InstallSelfHosted>;
        preflightSelfHostedInstall: Mock<PreflightSelfHostedInstall>;
      } => ({
        installDev: vi.fn<InstallDev>(),
        installSelfHosted: vi.fn<InstallSelfHosted>().mockResolvedValue(createInstallCommandResultFixture()),
        preflightSelfHostedInstall: vi.fn<PreflightSelfHostedInstall>().mockResolvedValue(undefined),
      }),
    );
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
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
        '--image-registry',
        'docker-hub',
        '--public-http-port',
        '80',
        '--public-https-port',
        '443',
        '--skip-session-persist',
      ],
      capture,
    );

    expectCliSuccess(result);
    expect(readCliStderr(capture)).toContain('Using published self-hosted image tag latest from Docker Hub.');
  });
});
