import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  deployResponseSchema,
  type DeploymentListResponse,
  type DeploymentReadSummary,
  type DeploymentStatusResponse,
  type DeployResponse,
} from '@compartment/contracts';
import type { DeploymentProgressReporterOptions } from '../src/commands/deployments/deployment.command.output.types';
import type { AuthenticatedContext } from '../src/services/context.types';
import type {
  DeploymentListCommandInput,
  PromoteCommandInput,
  ProjectDeploymentListResult,
  RollbackCommandInput,
} from '../src/services/deployment-movement.types';
import type { DeployCommandInput } from '../src/services/deployments.types';
import type { CliConfig } from '../src/store/config.types';
import {
  createActiveDeploymentReadSummaryFixture,
  createActiveDeploymentStatusResponseFixture,
  createCliConfigFixture,
  createDeploymentStatusResponseFixture,
  createDeployResponseFixture,
} from './cli-test.fixtures';
import {
  type CliCommandCapture,
  type CliCommandResult,
  type CliJsonResult,
  createCliCapture,
  expectCliFailure,
  expectCliSuccess,
  readCliStderr,
  readCliStdout,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  runCliJson,
} from './cli-test.harness';

type CreateDeployResultMessage = (response: DeploymentStatusResponse, options: ResultMessageOptions) => string;
type CreateDeployDetachMessage = (response: DeployResponse) => string;
type CreateDeploymentProgressReporter = (
  options: DeploymentProgressReporterOptions,
) => (response: DeploymentStatusResponse) => void;
type DeployProject = (
  context: AuthenticatedContext,
  input: DeployCommandInput,
) => Promise<DeployResponse | DeploymentStatusResponse>;
type ListProjectDeployments = (
  context: AuthenticatedContext,
  input: DeploymentListCommandInput,
) => Promise<ProjectDeploymentListResult>;
type PromoteProjectDeployment = (
  context: AuthenticatedContext,
  input: PromoteCommandInput,
) => Promise<DeploymentStatusResponse>;
type RollbackProjectDeployment = (
  context: AuthenticatedContext,
  input: RollbackCommandInput,
) => Promise<DeploymentStatusResponse>;
type ReadCliConfig = () => Promise<CliConfig>;

type CreateDeployDetachMessageMock = Mock<CreateDeployDetachMessage>;
type CreateDeployResultMessageMock = Mock<CreateDeployResultMessage>;
type CreateDeploymentProgressReporterMock = Mock<CreateDeploymentProgressReporter>;
type DeployProjectMock = Mock<DeployProject>;
type ListProjectDeploymentsMock = Mock<ListProjectDeployments>;
type WriteCliConfig = (config: CliConfig) => Promise<void>;

interface DeploymentCommandMocks {
  createDeployDetachMessageMock: CreateDeployDetachMessageMock;
  createDeployResultMessageMock: CreateDeployResultMessageMock;
  createDeploymentProgressReporterMock: CreateDeploymentProgressReporterMock;
  deployProjectMock: DeployProjectMock;
  writeCliConfigMock: Mock<WriteCliConfig>;
}

interface DeploymentListCommandMocks {
  listProjectDeploymentsMock: ListProjectDeploymentsMock;
}

interface ResultMessageOptions {
  now?: number | undefined;
  verbose?: boolean | undefined;
}

interface FailedMockDeploymentCommandModulesInput {
  error: Error;
}

interface SuccessfulMockDeploymentCommandModulesInput {
  config?: CliConfig | undefined;
  reporter: (response: DeploymentStatusResponse) => void;
  response: DeployResponse | DeploymentStatusResponse;
}

type MockDeploymentCommandModulesInput =
  | FailedMockDeploymentCommandModulesInput
  | SuccessfulMockDeploymentCommandModulesInput;

describe.sequential('compartment deployment commands', (): void => {
  const createdDirectories: string[] = [];

  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach(async (): Promise<void> => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    restoreCliCommandModules([
      '../src/commands/deployments/deployment.command.output',
      '../src/services/deployment-movement.service',
      '../src/services/deployments.service',
      '../src/store/config.store',
    ]);
    await Promise.all(
      createdDirectories.splice(0).map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
  });

  it('prints the detach follow-up message without streaming progress output', async (): Promise<void> => {
    const response: DeployResponse = createDeployResponse();
    const deployProjectMock: DeployProjectMock = vi.fn<DeployProject>().mockResolvedValue(response);
    const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(createCliConfigFixture());
    const writeCliConfigMock: Mock<WriteCliConfig> = vi.fn<WriteCliConfig>().mockResolvedValue(undefined);

    vi.doMock(
      '../src/services/deployments.service',
      (): {
        deployProject: DeployProjectMock;
      } => ({
        deployProject: deployProjectMock,
      }),
    );
    vi.doMock(
      '../src/store/config.store',
      (): { readCliConfig: Mock<ReadCliConfig>; writeCliConfig: Mock<WriteCliConfig> } => ({
        readCliConfig: readCliConfigMock,
        writeCliConfig: writeCliConfigMock,
      }),
    );
    const capture: CliCommandCapture = createCliCapture();
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/smoke-web');
    const result: CliCommandResult = await runCliCommand(['deploy', '--detach', '--service', 'web'], capture);

    expectCliSuccess(result);
    expect(readCliStdout(capture)).toContain(
      'Follow progress with compartment deployment logs --project smoke-web --env staging --run drn_123.',
    );
    expect(readCliStderr(capture)).toBe('');
  });

  it('returns the queued deploy response for detach json output', async (): Promise<void> => {
    const response: DeployResponse = createDeployResponse();
    const deployProjectMock: DeployProjectMock = vi.fn<DeployProject>().mockResolvedValue(response);
    const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(createCliConfigFixture());
    const writeCliConfigMock: Mock<WriteCliConfig> = vi.fn<WriteCliConfig>().mockResolvedValue(undefined);

    vi.doMock(
      '../src/services/deployments.service',
      (): {
        deployProject: DeployProjectMock;
      } => ({
        deployProject: deployProjectMock,
      }),
    );
    vi.doMock(
      '../src/store/config.store',
      (): { readCliConfig: Mock<ReadCliConfig>; writeCliConfig: Mock<WriteCliConfig> } => ({
        readCliConfig: readCliConfigMock,
        writeCliConfig: writeCliConfigMock,
      }),
    );
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/smoke-web');

    const result: CliJsonResult<DeployResponse> = await runCliJson(
      ['deploy', '--detach', '--output', 'json'],
      deployResponseSchema,
    );

    expectCliSuccess(result);
    expect(result.payload).toEqual(response);
  });

  it('clears the stored first-deploy onboarding session after an accepted detached deploy', async (): Promise<void> => {
    const mocks: DeploymentCommandMocks = mockDeploymentCommandModules({
      config: createCliConfigFixture({
        firstDeployOnboardingSessionId: 'fdo_123',
      }),
      reporter: vi.fn<(response: DeploymentStatusResponse) => void>(),
      response: createDeployResponse(),
    });
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/smoke-web');

    const result: CliCommandResult = await runCliCommand(['deploy', '--detach'], createCliCapture());

    expectCliSuccess(result);
    expect(mocks.writeCliConfigMock).toHaveBeenCalledOnce();
    const [clearedConfig] = mocks.writeCliConfigMock.mock.calls[0]!;
    expect(clearedConfig.remotes?.default).not.toHaveProperty('firstDeployOnboardingSessionId');
  });

  it('uses the stored first-deploy onboarding session without a deploy flag', async (): Promise<void> => {
    const response: DeploymentStatusResponse = createActiveDeploymentStatusResponseFixture();
    const mocks: DeploymentCommandMocks = mockDeploymentCommandModules({
      config: createCliConfigFixture({
        firstDeployOnboardingSessionId: 'fdo_123',
      }),
      reporter: vi.fn<(response: DeploymentStatusResponse) => void>(),
      response,
    });
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/smoke-web');

    const result: CliCommandResult = await runCliCommand(['deploy'], createCliCapture());

    expectCliSuccess(result);
    expect(mocks.deployProjectMock).toHaveBeenCalledOnce();
    const [context, input] = mocks.deployProjectMock.mock.calls[0]!;
    expect(context).toEqual(
      expect.objectContaining({
        firstDeployOnboardingSessionId: 'fdo_123',
      }),
    );
    expect(input).not.toHaveProperty('onboardingSessionId');
    expect(mocks.writeCliConfigMock).toHaveBeenCalledOnce();
    const [clearedConfig] = mocks.writeCliConfigMock.mock.calls[0]!;
    expect(clearedConfig.remotes?.default).not.toHaveProperty('firstDeployOnboardingSessionId');
  });

  it('renders deploy phase and status progress for text output', async (): Promise<void> => {
    const response: DeploymentStatusResponse = createActiveDeploymentStatusResponseFixture();
    const deployProjectMock: DeployProjectMock = vi
      .fn<DeployProject>()
      .mockImplementation(
        async (_context: AuthenticatedContext, input: DeployCommandInput): Promise<DeploymentStatusResponse> => {
          input.reportProgress?.('Preparing source archive...');
          input.onStatusUpdate?.(response);
          await Promise.resolve();
          return response;
        },
      );
    const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(createCliConfigFixture());
    const writeCliConfigMock: Mock<WriteCliConfig> = vi.fn<WriteCliConfig>().mockResolvedValue(undefined);
    vi.doMock('../src/services/deployments.service', (): { deployProject: DeployProjectMock } => ({
      deployProject: deployProjectMock,
    }));
    vi.doMock(
      '../src/store/config.store',
      (): { readCliConfig: Mock<ReadCliConfig>; writeCliConfig: Mock<WriteCliConfig> } => ({
        readCliConfig: readCliConfigMock,
        writeCliConfig: writeCliConfigMock,
      }),
    );
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/smoke-web');
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: false });

    const result: CliCommandResult = await runCliCommand(['deploy'], capture);

    expectCliSuccess(result);
    expect(readCliStderr(capture)).toContain('Preparing source archive...\n');
    expect(readCliStderr(capture)).toContain(
      'Deploy smoke-web/staging web: succeeded (active) in 5.0s. Route: https://smoke-web.preview.acme.dev.\n',
    );
    expect(readCliStdout(capture)).toContain('Deployment dep_123 is active at https://smoke-web.preview.acme.dev');
  });

  it('refreshes TTY deploy status progress when only elapsed time changes', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T10:00:01.200Z'));
    const runningDeployments: DeploymentReadSummary[] = ['web', 'internal-api', 'public-api'].map(
      (serviceName: string): DeploymentReadSummary =>
        createActiveDeploymentReadSummaryFixture({
          completedAt: null,
          health: 'pending',
          id: `dep_${serviceName}`,
          operation: {
            completedAt: null,
            createdAt: '2026-03-30T10:00:00.000Z',
            status: 'running',
          },
          promotionStage: 'building',
          routeUrl: null,
          serviceName,
          status: 'running',
        }),
    );
    const runningResponse: DeploymentStatusResponse = createDeploymentStatusResponseFixture({
      activeDeployments: [],
      deployments: runningDeployments,
    });
    const succeededResponse: DeploymentStatusResponse = createActiveDeploymentStatusResponseFixture();
    const deployProjectMock: DeployProjectMock = vi
      .fn<DeployProject>()
      .mockImplementation(
        async (_context: AuthenticatedContext, input: DeployCommandInput): Promise<DeploymentStatusResponse> => {
          input.reportProgress?.('Preparing source archive...');
          input.reportWarning?.('Legacy restart warning');
          input.onStatusUpdate?.(runningResponse);
          vi.advanceTimersByTime(120);
          vi.setSystemTime(new Date('2026-03-30T10:00:03.200Z'));
          input.onStatusUpdate?.(runningResponse);
          vi.advanceTimersByTime(120);
          await Promise.resolve();
          return succeededResponse;
        },
      );
    const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(createCliConfigFixture());
    const writeCliConfigMock: Mock<WriteCliConfig> = vi.fn<WriteCliConfig>().mockResolvedValue(undefined);
    vi.doMock('../src/services/deployments.service', (): { deployProject: DeployProjectMock } => ({
      deployProject: deployProjectMock,
    }));
    vi.doMock(
      '../src/store/config.store',
      (): { readCliConfig: Mock<ReadCliConfig>; writeCliConfig: Mock<WriteCliConfig> } => ({
        readCliConfig: readCliConfigMock,
        writeCliConfig: writeCliConfigMock,
      }),
    );
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/smoke-web');
    const capture: CliCommandCapture = createCliCapture({ stderrColumns: 120, stderrIsTTY: true });

    const result: CliCommandResult = await runCliCommand(['deploy'], capture);

    expectCliSuccess(result);
    const stderr: string = readCliStderr(capture);
    expect(stderr).toContain('Legacy restart warning\n');
    const progressFrames: string[] = stderr.split('\r\u001B[2K').filter((frame: string): boolean => frame !== '');
    expect(progressFrames.every((frame: string): boolean => frame.length < 120)).toBe(true);
    expect(progressFrames.some((frame: string): boolean => frame.includes('elapsed 1.2s'))).toBe(true);
    expect(progressFrames.some((frame: string): boolean => frame.includes('elapsed 3.2s'))).toBe(true);
    expect(progressFrames.some((frame: string): boolean => frame.endsWith('...'))).toBe(true);
    expect(stderr.indexOf('elapsed 1.2s')).toBeLessThan(stderr.indexOf('elapsed 3.2s'));
    expect(stderr.endsWith('\r\u001B[2K')).toBe(true);
    expect(readCliStdout(capture)).toContain('Deployment dep_123 is active at https://smoke-web.preview.acme.dev');
  });

  it('suppresses deploy progress for JSON output', async (): Promise<void> => {
    const response: DeploymentStatusResponse = createActiveDeploymentStatusResponseFixture();
    const deployProjectMock: DeployProjectMock = vi
      .fn<DeployProject>()
      .mockImplementation(
        async (_context: AuthenticatedContext, input: DeployCommandInput): Promise<DeploymentStatusResponse> => {
          input.reportProgress?.('Preparing source archive...');
          input.reportWarning?.('Legacy restart warning');
          input.onStatusUpdate?.(response);
          await Promise.resolve();
          return response;
        },
      );
    const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(createCliConfigFixture());
    const writeCliConfigMock: Mock<WriteCliConfig> = vi.fn<WriteCliConfig>().mockResolvedValue(undefined);
    vi.doMock('../src/services/deployments.service', (): { deployProject: DeployProjectMock } => ({
      deployProject: deployProjectMock,
    }));
    vi.doMock(
      '../src/store/config.store',
      (): { readCliConfig: Mock<ReadCliConfig>; writeCliConfig: Mock<WriteCliConfig> } => ({
        readCliConfig: readCliConfigMock,
        writeCliConfig: writeCliConfigMock,
      }),
    );
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/smoke-web');
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: true });

    const result: CliCommandResult = await runCliCommand(['deploy', '--output', 'json'], capture);

    expectCliSuccess(result);
    expect(readCliStderr(capture)).toBe('Legacy restart warning\n');
    expect(JSON.parse(readCliStdout(capture))).toMatchObject({
      project: {
        name: 'smoke-web',
      },
    });
  });

  it.each([
    ['partial value', ['--limit', '10abc']],
    ['decimal', ['--limit', '1.5']],
    ['empty value', ['--limit', '']],
    ['zero', ['--limit', '0']],
    ['negative', ['--limit', '-1']],
    ['above contract max', ['--limit', '101']],
  ])('rejects malformed deployment list --limit %s', async (_caseName: string, limitArgs: string[]): Promise<void> => {
    const mocks: DeploymentListCommandMocks = mockDeploymentListCommandModules();

    const result: CliCommandResult = await runCliCommand(
      ['deployment', 'list', '--project', 'smoke-web', ...limitArgs],
      createCliCapture(),
    );

    expectCliFailure(result, '--limit must be a positive integer up to 100.');
    expect(mocks.listProjectDeploymentsMock).not.toHaveBeenCalled();
  });

  it('rejects combining rollback --run with --service', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(
      ['rollback', '--run', 'drn_123', '--service', 'web'],
      createCliCapture(),
    );

    expectCliFailure(result, 'Rollback to a deployment run does not accept --service.');
  });

  it('rejects combining rollback --run with --to', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(
      ['rollback', '--run', 'drn_123', '--to', 'dep_123'],
      createCliCapture(),
    );

    expectCliFailure(result, 'Rollback accepts either --run <deployment-run-id> or --to <deployment-id>, not both.');
  });

  it('renders promote and rollback progress without requiring verbose output', async (): Promise<void> => {
    const response: DeploymentStatusResponse = createActiveDeploymentStatusResponseFixture();
    const promoteProjectDeploymentMock: Mock<PromoteProjectDeployment> = vi
      .fn<PromoteProjectDeployment>()
      .mockImplementation(
        async (_context: AuthenticatedContext, input: PromoteCommandInput): Promise<DeploymentStatusResponse> => {
          input.reportProgress?.('Promoting deployment...');
          input.onStatusUpdate?.(response);
          await Promise.resolve();
          return response;
        },
      );
    const rollbackProjectDeploymentMock: Mock<RollbackProjectDeployment> = vi
      .fn<RollbackProjectDeployment>()
      .mockImplementation(
        async (_context: AuthenticatedContext, input: RollbackCommandInput): Promise<DeploymentStatusResponse> => {
          input.reportProgress?.('Rolling back deployment...');
          input.onStatusUpdate?.(response);
          await Promise.resolve();
          return response;
        },
      );
    const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(createCliConfigFixture());
    vi.doMock(
      '../src/services/deployment-movement.service',
      (): {
        listProjectDeployments: Mock<ListProjectDeployments>;
        promoteProjectDeployment: Mock<PromoteProjectDeployment>;
        rollbackProjectDeployment: Mock<RollbackProjectDeployment>;
      } => ({
        listProjectDeployments: vi.fn<ListProjectDeployments>(),
        promoteProjectDeployment: promoteProjectDeploymentMock,
        rollbackProjectDeployment: rollbackProjectDeploymentMock,
      }),
    );
    vi.doMock('../src/store/config.store', (): { readCliConfig: Mock<ReadCliConfig> } => ({
      readCliConfig: readCliConfigMock,
    }));
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/smoke-web');
    const promoteCapture: CliCommandCapture = createCliCapture({ stderrIsTTY: false });
    const rollbackCapture: CliCommandCapture = createCliCapture({ stderrIsTTY: false });

    const promoteResult: CliCommandResult = await runCliCommand(
      ['promote', '--from', 'staging', '--to', 'production'],
      promoteCapture,
    );
    const rollbackResult: CliCommandResult = await runCliCommand(['rollback', '--env', 'production'], rollbackCapture);

    expectCliSuccess(promoteResult);
    expect(readCliStderr(promoteCapture)).toContain('Promoting deployment...\n');
    expect(readCliStderr(promoteCapture)).toContain('Deploy smoke-web/staging web: succeeded (active) in 5.0s.');
    expectCliSuccess(rollbackResult);
    expect(readCliStderr(rollbackCapture)).toContain('Rolling back deployment...\n');
    expect(readCliStderr(rollbackCapture)).toContain('Deploy smoke-web/staging web: succeeded (active) in 5.0s.');
  });

  it('surfaces deployment command failures', async (): Promise<void> => {
    const error: Error = new Error('Deployment failed.');
    const mocks: DeploymentCommandMocks = mockDeploymentCommandModules({
      error,
    });
    const result: CliCommandResult = await runCliCommand(['deploy'], createCliCapture());

    expectCliFailure(result, 'Deployment failed.');
    expect(mocks.createDeployResultMessageMock).not.toHaveBeenCalled();
  });

  it('fails before deploy when a repo has no binding and multiple remotes are configured', async (): Promise<void> => {
    const cwd: string = await mkdtemp(join(tmpdir(), 'compartment-cli-deploy-'));
    createdDirectories.push(cwd);
    await mkdir(join(cwd, '.git'));
    await writeFile(join(cwd, 'compartment.yml'), 'name: smoke-web\nservices:\n  web: .\n', 'utf8');

    mockDeploymentCommandModules({
      config: {
        remotes: {
          eu: {
            apiUrl: 'https://eu.example.com',
            sessionToken: 'eu-session',
          },
          lab: {
            apiUrl: 'https://lab.example.com',
            sessionToken: 'lab-session',
          },
        },
      },
      reporter: vi.fn<(response: DeploymentStatusResponse) => void>(),
      response: createDeployResponse(),
    });
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);

    const result: CliCommandResult = await runCliCommand(['deploy'], createCliCapture());

    expectCliFailure(
      result,
      'Multiple remotes are configured and this repo is not bound to one. Pass --remote <name> or run `compartment remote use <name>` first.',
    );
  });

  it('fails instead of prompting for remote selection with JSON output', async (): Promise<void> => {
    const cwd: string = await mkdtemp(join(tmpdir(), 'compartment-cli-deploy-'));
    createdDirectories.push(cwd);
    await writeFile(join(cwd, 'compartment.yml'), 'name: smoke-web\nservices:\n  web: .\n', 'utf8');

    mockDeploymentCommandModules({
      config: {
        remotes: {
          eu: {
            apiUrl: 'https://eu.example.com',
            sessionToken: 'eu-session',
          },
          lab: {
            apiUrl: 'https://lab.example.com',
            sessionToken: 'lab-session',
          },
        },
      },
      reporter: vi.fn<(response: DeploymentStatusResponse) => void>(),
      response: createDeployResponse(),
    });
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);

    const result: CliCommandResult = await runCliCommand(
      ['deploy', '--output', 'json'],
      createCliCapture({ isTTY: true }),
    );

    expectCliFailure(
      result,
      'Multiple remotes are configured and this repo is not bound to one. Pass --remote <name> or run `compartment remote use <name>` first.',
    );
  });

  it('prompts for a remote and stores the repo binding before deploy', async (): Promise<void> => {
    const cwd: string = await mkdtemp(join(tmpdir(), 'compartment-cli-deploy-'));
    createdDirectories.push(cwd);
    await mkdir(join(cwd, '.git'));
    await writeFile(join(cwd, 'compartment.yml'), 'name: smoke-web\nservices:\n  web: .\n', 'utf8');

    mockDeploymentCommandModules({
      config: {
        currentRemote: 'eu',
        remotes: {
          eu: {
            apiUrl: 'https://eu.example.com',
            sessionToken: 'eu-session',
          },
          lab: {
            apiUrl: 'https://lab.example.com',
            sessionToken: 'lab-session',
          },
        },
      },
      reporter: vi.fn<(response: DeploymentStatusResponse) => void>(),
      response: createDeployResponse(),
    });
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
    capture.stdin.end('2\n');
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);

    const result: CliCommandResult = await runCliCommand(['deploy'], capture);

    expectCliSuccess(result);
    expect(readCliStderr(capture)).toContain('Select a remote to deploy to');
    expect(readCliStderr(capture)).toContain('1. eu (current)');
    expect(readCliStderr(capture)).toContain('2. lab');
    await expect(readFile(join(cwd, '.compartment', 'state.json'), 'utf8')).resolves.toBe(
      '{\n  "selectedRemote": "lab"\n}\n',
    );
    await expect(readFile(join(cwd, '.gitignore'), 'utf8')).resolves.toBe('.compartment/state.json\n');
  });
});

function createDeployResponse(): DeployResponse {
  return createDeployResponseFixture({
    deployment: {
      completedAt: '2026-03-30T10:00:05.000Z',
      createdAt: '2026-03-30T10:00:00.000Z',
      health: 'healthy',
      isActive: true,
      operation: {
        completedAt: null,
        createdAt: '2026-03-30T10:00:00.000Z',
        id: 'op_123',
        status: 'succeeded',
        targetId: 'env_123',
        targetType: 'environment',
        type: 'deployment.run',
      },
      promotionStage: 'active',
      routeUrl: 'https://smoke-web.preview.acme.dev',
      status: 'succeeded',
    },
  });
}

function createDeploymentListResponse(): DeploymentListResponse {
  return {
    deployments: [],
    environment: {
      name: 'staging',
    },
    project: {
      name: 'smoke-web',
    },
  };
}

function mockDeploymentListCommandModules(
  response: DeploymentListResponse = createDeploymentListResponse(),
): DeploymentListCommandMocks {
  const listProjectDeploymentsMock: ListProjectDeploymentsMock = vi.fn<ListProjectDeployments>().mockResolvedValue({
    environmentName: response.environment.name,
    response,
  });
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(createCliConfigFixture());

  vi.doMock(
    '../src/services/deployment-movement.service',
    (): {
      listProjectDeployments: ListProjectDeploymentsMock;
    } => ({
      listProjectDeployments: listProjectDeploymentsMock,
    }),
  );
  vi.doMock('../src/store/config.store', (): { readCliConfig: Mock<ReadCliConfig> } => ({
    readCliConfig: readCliConfigMock,
  }));

  return {
    listProjectDeploymentsMock,
  };
}

function mockDeploymentCommandModules(input: MockDeploymentCommandModulesInput): DeploymentCommandMocks {
  const createDeployDetachMessageMock: CreateDeployDetachMessageMock = vi
    .fn<CreateDeployDetachMessage>()
    .mockReturnValue('deploy queued');
  const createDeployResultMessageMock: CreateDeployResultMessageMock = vi
    .fn<CreateDeployResultMessage>()
    .mockReturnValue('deploy summary');
  const createDeploymentProgressReporterMock: CreateDeploymentProgressReporterMock = vi
    .fn<CreateDeploymentProgressReporter>()
    .mockReturnValue('reporter' in input ? input.reporter : vi.fn<(response: DeploymentStatusResponse) => void>());
  const deployProjectMock: DeployProjectMock = vi.fn<DeployProject>();
  const readCliConfigMock: Mock<ReadCliConfig> = vi
    .fn<ReadCliConfig>()
    .mockResolvedValue('config' in input && input.config !== undefined ? input.config : createCliConfigFixture());
  const writeCliConfigMock: Mock<WriteCliConfig> = vi.fn<WriteCliConfig>().mockResolvedValue(undefined);

  if ('error' in input) {
    deployProjectMock.mockRejectedValue(input.error);
  } else {
    deployProjectMock.mockResolvedValue(input.response);
  }

  vi.doMock(
    '../src/commands/deployments/deployment.command.output',
    (): {
      createDeployDetachMessage: CreateDeployDetachMessageMock;
      createDeployResultMessage: CreateDeployResultMessageMock;
      createDeploymentProgressReporter: CreateDeploymentProgressReporterMock;
    } => ({
      createDeployDetachMessage: createDeployDetachMessageMock,
      createDeployResultMessage: createDeployResultMessageMock,
      createDeploymentProgressReporter: createDeploymentProgressReporterMock,
    }),
  );
  vi.doMock(
    '../src/services/deployments.service',
    (): {
      deployProject: DeployProjectMock;
    } => ({
      deployProject: deployProjectMock,
    }),
  );
  vi.doMock(
    '../src/store/config.store',
    (): { readCliConfig: Mock<ReadCliConfig>; writeCliConfig: Mock<WriteCliConfig> } => ({
      readCliConfig: readCliConfigMock,
      writeCliConfig: writeCliConfigMock,
    }),
  );

  return {
    createDeployDetachMessageMock,
    createDeployResultMessageMock,
    createDeploymentProgressReporterMock,
    deployProjectMock,
    writeCliConfigMock,
  };
}
