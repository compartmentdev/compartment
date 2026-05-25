import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { DeploymentLogLine, DeploymentLogsResponse, DeploymentReadSummary } from '@compartment/contracts';
import type { AuthenticatedContext } from '../src/services/context.types';
import type { LogsCommandInput } from '../src/services/deployments.types';
import type { CliConfig } from '../src/store/config.types';
import { createCliConfigFixture } from './cli-test.fixtures';
import {
  type CliCommandCapture,
  type CliCommandResult,
  createCliCapture,
  expectCliFailure,
  expectCliSuccess,
  readCliStdout,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
} from './cli-test.harness';

type GetProjectDeploymentLogs = (
  context: AuthenticatedContext,
  input: LogsCommandInput,
) => Promise<DeploymentLogsResponse>;
type MockLogsCommandResponse = DeploymentLogsResponse | Error;
type MockDeploymentLogStream = 'compartment' | 'stderr' | 'stdout';
type ReadCliConfig = () => Promise<CliConfig>;
type Sleep = (delay: number, value?: undefined, options?: { signal?: AbortSignal | undefined }) => Promise<void>;

interface LogsCommandMocks {
  getProjectDeploymentLogsMock: Mock<GetProjectDeploymentLogs>;
  sleepMock: Mock<Sleep>;
}

interface MockLogsCommandModulesInput {
  capture?: CliCommandCapture | undefined;
  responses: MockLogsCommandResponse[];
}

describe.sequential('compartment logs command', (): void => {
  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach((): void => {
    restoreCliCommandModules([
      '../src/services/deployments.service',
      '../src/store/config.store',
      'node:timers/promises',
    ]);
  });

  it('rejects follow mode for json output', async (): Promise<void> => {
    mockLogsCommandModules({
      responses: [],
    });

    const result: CliCommandResult = await runCliCommand(['logs', '--follow', '--output', 'json'], createCliCapture());

    expectCliFailure(result, '`--follow` cannot be combined with `--output json`.');
  });

  it('streams only new log lines while following', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    const firstResponse: DeploymentLogsResponse = createLogsResponse([
      createLogLine('2026-03-23T12:00:00.000Z', 'boot complete'),
    ]);
    const secondResponse: DeploymentLogsResponse = createLogsResponse([
      createLogLine('2026-03-23T12:00:00.000Z', 'boot complete'),
      createLogLine('2026-03-23T12:00:00.000Z', 'still booting'),
      createLogLine('2026-03-23T12:00:01.000Z', 'listening'),
    ]);
    const thirdResponse: DeploymentLogsResponse = createLogsResponse([]);
    const mocks: LogsCommandMocks = mockLogsCommandModules({
      capture,
      responses: [firstResponse, secondResponse, thirdResponse],
    });
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/smoke-web');

    const result: CliCommandResult = await runCliCommand(['logs', '--follow'], capture);

    expectCliSuccess(result);
    expect(mocks.getProjectDeploymentLogsMock).toHaveBeenNthCalledWith(1, expect.anything(), {
      cwd: '/tmp/smoke-web',
      environmentName: undefined,
      projectName: undefined,
      serviceName: undefined,
      since: undefined,
    });
    expect(mocks.getProjectDeploymentLogsMock).toHaveBeenNthCalledWith(2, expect.anything(), {
      cwd: '/tmp/smoke-web',
      environmentName: undefined,
      projectName: undefined,
      serviceName: undefined,
      since: '2026-03-23T12:00:00.000000000Z',
    });
    expect(mocks.getProjectDeploymentLogsMock).toHaveBeenNthCalledWith(3, expect.anything(), {
      cwd: '/tmp/smoke-web',
      environmentName: undefined,
      projectName: undefined,
      serviceName: undefined,
      since: '2026-03-23T12:00:01.000000000Z',
    });
    expect(mocks.sleepMock).toHaveBeenCalledTimes(3);
    expect(readCliStdout(capture)).toBe(
      '2026-03-23T12:00:00.000Z stdout boot complete\n' +
        '2026-03-23T12:00:00.000Z stdout still booting\n' +
        '2026-03-23T12:00:01.000Z stdout listening\n',
    );
  });

  it('surfaces follow polling failures instead of swallowing them', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    mockLogsCommandModules({
      capture,
      responses: [
        createLogsResponse([createLogLine('2026-03-23T12:00:00.000Z', 'boot complete')]),
        new Error('Logs poll failed.'),
      ],
    });

    const result: CliCommandResult = await runCliCommand(['logs', '--follow'], capture);

    expectCliFailure(result, 'Logs poll failed.');
    expect(readCliStdout(capture)).toBe('2026-03-23T12:00:00.000Z stdout boot complete\n');
  });

  it('keeps service labels while following aggregated project logs', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    mockLogsCommandModules({
      capture,
      responses: [
        createAggregateLogsResponse([
          createLogLine('2026-03-23T12:00:00.000Z', 'boot complete'),
          createLogLine('2026-03-23T12:00:01.000Z', 'admin ready', 'admin', 'dep_456'),
        ]),
        createAggregateLogsResponse([
          createLogLine('2026-03-23T12:00:01.000Z', 'admin ready', 'admin', 'dep_456'),
          createLogLine('2026-03-23T12:00:02.000Z', 'listening'),
        ]),
        createAggregateLogsResponse([]),
      ],
    });

    const result: CliCommandResult = await runCliCommand(['logs', '--follow'], capture);

    expectCliSuccess(result);
    expect(readCliStdout(capture)).toBe(
      '2026-03-23T12:00:00.000Z [web] stdout boot complete\n' +
        '2026-03-23T12:00:01.000Z [admin] stdout admin ready\n' +
        '2026-03-23T12:00:02.000Z [web] stdout listening\n',
    );
  });

  it('deduplicates nanosecond docker lines against millisecond follow cursors', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    const repeatedDockerLine: DeploymentLogLine = createLogLine('2026-03-23T12:00:00.123000000Z', 'boot complete');
    const repeatedEventLine: DeploymentLogLine = createLogLine(
      '2026-03-23T12:00:00.123Z',
      'deployment.create',
      'web',
      'dep_123',
      'compartment',
    );
    const mocks: LogsCommandMocks = mockLogsCommandModules({
      capture,
      responses: [
        createLogsResponse([repeatedDockerLine, repeatedEventLine]),
        createLogsResponse([repeatedDockerLine, repeatedEventLine]),
        createLogsResponse([]),
      ],
    });
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/smoke-web');

    const result: CliCommandResult = await runCliCommand(['logs', '--follow'], capture);

    expectCliSuccess(result);
    expect(mocks.getProjectDeploymentLogsMock).toHaveBeenNthCalledWith(2, expect.anything(), {
      cwd: '/tmp/smoke-web',
      environmentName: undefined,
      projectName: undefined,
      serviceName: undefined,
      since: '2026-03-23T12:00:00.123000000Z',
    });
    expect(readCliStdout(capture)).toBe(
      '2026-03-23T12:00:00.123000000Z stdout boot complete\n' +
        '2026-03-23T12:00:00.123Z compartment deployment.create\n',
    );
  });
});

interface CreateDeploymentSummaryInput {
  deploymentId?: string | undefined;
  routeUrl?: string | undefined;
  serviceName?: string | undefined;
}

function mockLogsCommandModules(input: MockLogsCommandModulesInput): LogsCommandMocks {
  const getProjectDeploymentLogsMock: Mock<GetProjectDeploymentLogs> = vi.fn<GetProjectDeploymentLogs>();
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(createCliConfigFixture());
  const sleepMock: Mock<Sleep> = vi
    .fn<Sleep>()
    .mockImplementation(
      async (_delay: number, _value?: undefined, options?: { signal?: AbortSignal | undefined }): Promise<void> => {
        if (options?.signal?.aborted === true || input.responses.length === 0) {
          const abortError: Error = new Error('The operation was aborted.');
          abortError.name = 'AbortError';
          throw abortError;
        }

        await Promise.resolve();
      },
    );

  if (input.capture !== undefined) {
    getProjectDeploymentLogsMock.mockImplementation(
      async (_context: AuthenticatedContext, request: LogsCommandInput): Promise<DeploymentLogsResponse> => {
        const response: MockLogsCommandResponse | undefined = input.responses.shift();
        if (response === undefined) {
          input.capture?.stdin.destroy();
          throw new Error(`Unexpected logs request with since=${request.since ?? '<none>'}.`);
        }

        if (response instanceof Error) {
          throw response;
        }

        return await Promise.resolve(response);
      },
    );
  }

  vi.doMock(
    '../src/services/deployments.service',
    (): {
      getProjectDeploymentLogs: Mock<GetProjectDeploymentLogs>;
    } => ({
      getProjectDeploymentLogs: getProjectDeploymentLogsMock,
    }),
  );
  vi.doMock('../src/store/config.store', (): { readCliConfig: Mock<ReadCliConfig> } => ({
    readCliConfig: readCliConfigMock,
  }));
  vi.doMock('node:timers/promises', (): { setTimeout: Mock<Sleep> } => ({
    setTimeout: sleepMock,
  }));

  return {
    getProjectDeploymentLogsMock,
    sleepMock,
  };
}

function createLogsResponse(
  lines: DeploymentLogLine[],
  deployments: DeploymentReadSummary[] = [createDeploymentSummary()],
): DeploymentLogsResponse {
  return {
    deployments,
    environment: {
      name: 'production',
    },
    lines,
    project: {
      name: 'smoke-web',
    },
  };
}

function createAggregateLogsResponse(lines: DeploymentLogLine[]): DeploymentLogsResponse {
  return createLogsResponse(lines, [
    createDeploymentSummary(),
    createDeploymentSummary({
      deploymentId: 'dep_456',
      routeUrl: 'https://smoke-admin.preview.acme.dev',
      serviceName: 'admin',
    }),
  ]);
}

function createDeploymentSummary(input: CreateDeploymentSummaryInput = {}): DeploymentReadSummary {
  const deploymentId: string = input.deploymentId ?? 'dep_123';

  return {
    completedAt: '2026-03-23T12:00:05.000Z',
    createdAt: '2026-03-23T12:00:00.000Z',
    deploymentRunId: input.deploymentId === 'dep_456' ? 'drn_456' : 'drn_123',
    failureMessage: null,
    health: 'healthy',
    id: deploymentId,
    isActive: true,
    label: null,
    operation: {
      completedAt: '2026-03-23T12:00:05.000Z',
      createdAt: '2026-03-23T12:00:00.000Z',
      status: 'succeeded',
      type: 'deployment.create',
    },
    promotionStage: 'active',
    rollbackAvailable: false,
    routeUrl: input.routeUrl ?? 'https://smoke-web.preview.acme.dev',
    serviceName: input.serviceName ?? 'web',
    status: 'succeeded',
  };
}

function createLogLine(
  timestamp: string,
  message: string,
  serviceName: string = 'web',
  deploymentId: string = serviceName === 'admin' ? 'dep_456' : 'dep_123',
  stream: MockDeploymentLogStream = 'stdout',
): DeploymentLogLine {
  return {
    deploymentId,
    environmentName: 'production',
    message,
    serviceName,
    stream,
    timestamp,
  };
}
