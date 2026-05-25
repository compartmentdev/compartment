import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { type DeploymentRunLogsResponse } from '@compartment/contracts';
import type { AuthenticatedContext } from '../src/services/context.types';
import type { DeploymentLogsCommandInput } from '../src/services/deployments.types';
import type { CliConfig } from '../src/store/config.types';
import { createCliRemoteConfigFixture } from './cli-test.fixtures';
import {
  type CliCommandResult,
  createCliCapture,
  expectCliFailure,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
} from './cli-test.harness';

type CreateDeploymentRunLogsResultMessage = (
  response: DeploymentRunLogsResponse,
  options: {
    verbose?: boolean | undefined;
  },
) => string;
type GetProjectDeploymentRunLogs = (
  context: AuthenticatedContext,
  input: DeploymentLogsCommandInput,
) => Promise<DeploymentRunLogsResponse>;
type ReadCliConfig = () => Promise<CliConfig>;

interface DeploymentLogsCommandMocks {
  getProjectDeploymentRunLogsMock: Mock<GetProjectDeploymentRunLogs>;
}

describe.sequential('compartment deployment logs command', (): void => {
  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach((): void => {
    vi.restoreAllMocks();
    restoreCliCommandModules([
      '../src/services/deployment-run-logs-output.service',
      '../src/services/deployment-run-logs.service',
      '../src/store/config.store',
    ]);
  });

  it('shows remote selection guidance when no remote is selected', async (): Promise<void> => {
    const mocks: DeploymentLogsCommandMocks = mockDeploymentLogsCommandModules({
      config: {
        remotes: {
          lab: createCliRemoteConfigFixture({
            apiUrl: 'https://lab.console.example',
            sessionToken: 'lab-session',
          }),
        },
      },
    });

    const result: CliCommandResult = await runCliCommand(
      ['deployment', 'logs', '--run', 'drn_123'],
      createCliCapture(),
    );

    expectCliFailure(
      result,
      'No remote is selected. Pass --remote <name> or run `compartment remote use <name>` first.',
    );
    expect(mocks.getProjectDeploymentRunLogsMock).not.toHaveBeenCalled();
  });
});

function mockDeploymentLogsCommandModules(input: { config: CliConfig }): DeploymentLogsCommandMocks {
  const createDeploymentRunLogsResultMessageMock: Mock<CreateDeploymentRunLogsResultMessage> = vi
    .fn<CreateDeploymentRunLogsResultMessage>()
    .mockReturnValue('deployment logs summary');
  const getProjectDeploymentRunLogsMock: Mock<GetProjectDeploymentRunLogs> = vi.fn<GetProjectDeploymentRunLogs>();
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(input.config);

  vi.doMock(
    '../src/services/deployment-run-logs-output.service',
    (): {
      createDeploymentRunLogsResultMessage: Mock<CreateDeploymentRunLogsResultMessage>;
    } => ({
      createDeploymentRunLogsResultMessage: createDeploymentRunLogsResultMessageMock,
    }),
  );
  vi.doMock(
    '../src/services/deployment-run-logs.service',
    (): {
      getProjectDeploymentRunLogs: Mock<GetProjectDeploymentRunLogs>;
    } => ({
      getProjectDeploymentRunLogs: getProjectDeploymentRunLogsMock,
    }),
  );
  vi.doMock('../src/store/config.store', (): { readCliConfig: Mock<ReadCliConfig> } => ({
    readCliConfig: readCliConfigMock,
  }));

  return {
    getProjectDeploymentRunLogsMock,
  };
}
