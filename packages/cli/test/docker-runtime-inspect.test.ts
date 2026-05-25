import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { inspectSelfHostedRuntimeServices } from '../src/docker-runtime';
import type { CommandResult } from '../src/command-runner.types';
import type {
  DockerExecutionContext,
  DockerExecutionMode,
  InspectSelfHostedRuntimeInput,
  SelfHostedRuntimeServiceInspection,
} from '../src/docker-runtime.types';

type RunCappedCommand = (command: readonly string[], env?: NodeJS.ProcessEnv) => Promise<CommandResult>;
type RunCommand = (command: readonly string[], env?: NodeJS.ProcessEnv) => Promise<CommandResult>;
type RunInheritedCommand = (command: readonly string[], env?: NodeJS.ProcessEnv) => Promise<CommandResult>;
type InspectNodeAgentHostService = (input: { nodeSocketPath: string }) => Promise<SelfHostedRuntimeServiceInspection>;

interface DockerRuntimeInspectTestMocks {
  inspectNodeAgentHostService: Mock<InspectNodeAgentHostService>;
  runCappedCommand: Mock<RunCappedCommand>;
  runCommand: Mock<RunCommand>;
  runInheritedCommand: Mock<RunInheritedCommand>;
}

const mocks: DockerRuntimeInspectTestMocks = vi.hoisted(
  (): DockerRuntimeInspectTestMocks => ({
    inspectNodeAgentHostService: vi.fn<InspectNodeAgentHostService>(),
    runCappedCommand: vi.fn<RunCappedCommand>(),
    runCommand: vi.fn<RunCommand>(),
    runInheritedCommand: vi.fn<RunInheritedCommand>(),
  }),
);

vi.mock(
  '../src/command-runner',
  (): {
    readCommandOutput: (result: CommandResult) => string;
    runCappedCommand: Mock<RunCappedCommand>;
    runCommand: Mock<RunCommand>;
    runInheritedCommand: Mock<RunInheritedCommand>;
  } => ({
    readCommandOutput: (result: CommandResult): string =>
      [result.stderr.trim(), result.stdout.trim()].filter((value: string): boolean => value !== '').join('\n'),
    runCappedCommand: mocks.runCappedCommand,
    runCommand: mocks.runCommand,
    runInheritedCommand: mocks.runInheritedCommand,
  }),
);

vi.mock('../src/node-agent-service', (): { inspectNodeAgentHostService: Mock<InspectNodeAgentHostService> } => ({
  inspectNodeAgentHostService: mocks.inspectNodeAgentHostService,
}));

beforeEach((): void => {
  mocks.inspectNodeAgentHostService.mockResolvedValue(createNodeInspection('healthy'));
});

afterEach((): void => {
  mocks.inspectNodeAgentHostService.mockReset();
  mocks.runCappedCommand.mockReset();
  mocks.runCommand.mockReset();
  mocks.runInheritedCommand.mockReset();
});

describe('inspectSelfHostedRuntimeServices', (): void => {
  it('reads system service state from compose ps and docker inspect', async (): Promise<void> => {
    mocks.runCappedCommand
      .mockResolvedValueOnce(createSuccessfulCommandResult(JSON.stringify([createComposeApiService()])))
      .mockResolvedValueOnce(createSuccessfulCommandResult(JSON.stringify([createDockerApiInspection()])));

    const result: SelfHostedRuntimeServiceInspection[] = await inspectSelfHostedRuntimeServices(
      createDockerExecutionContext('direct'),
      createInspectInput(),
    );

    expect(result[0]).toEqual({
      containerId: 'container_api',
      health: 'healthy',
      imageRef: 'ghcr.io/compartmentdev/compartment-api:0.2.0',
      name: 'api',
      publishedPorts: [{ containerPort: 39444, hostIp: '127.0.0.1', hostPort: 39444 }],
      startedAt: '2026-04-09T11:00:00.000Z',
      status: 'running',
    });
    expect(result.find((service: SelfHostedRuntimeServiceInspection): boolean => service.name === 'node')).toEqual(
      createNodeInspection('healthy'),
    );
  });

  it('keeps node agent socket health visible when compose inspection fails', async (): Promise<void> => {
    mocks.runCappedCommand.mockResolvedValueOnce(createFailedCommandResult('docker unavailable', 1));

    const result: SelfHostedRuntimeServiceInspection[] = await inspectSelfHostedRuntimeServices(
      createDockerExecutionContext('direct'),
      createInspectInput(),
    );

    expect(result.find((service: SelfHostedRuntimeServiceInspection): boolean => service.name === 'node')).toEqual(
      createNodeInspection('healthy'),
    );
    expect(
      result
        .filter((service: SelfHostedRuntimeServiceInspection): boolean => service.name !== 'node')
        .every((service: SelfHostedRuntimeServiceInspection): boolean => service.status === 'missing'),
    ).toBe(true);
    expect(mocks.inspectNodeAgentHostService).toHaveBeenCalledWith({
      nodeSocketPath: '/var/run/compartment/node/agent.sock',
    });
  });

  it('keeps node inspection owned by the host service even if compose output contains node', async (): Promise<void> => {
    mocks.runCappedCommand
      .mockResolvedValueOnce(
        createSuccessfulCommandResult(JSON.stringify([createComposeApiService(), createComposeNodeService()])),
      )
      .mockResolvedValueOnce(createSuccessfulCommandResult(JSON.stringify([createDockerApiInspection()])));

    const result: SelfHostedRuntimeServiceInspection[] = await inspectSelfHostedRuntimeServices(
      createDockerExecutionContext('direct'),
      createInspectInput(),
    );

    expect(result.find((service: SelfHostedRuntimeServiceInspection): boolean => service.name === 'node')).toEqual(
      createNodeInspection('healthy'),
    );
    expect(mocks.runCappedCommand).toHaveBeenCalledTimes(2);
  });
});

function createInspectInput(): InspectSelfHostedRuntimeInput {
  return {
    composePath: '/tmp/compartment/docker-compose.self-hosted.yml',
    envPath: '/tmp/compartment/.env.self-hosted',
    imageSource: 'registry',
    installDirectory: '/tmp/compartment',
    localComposePath: '/tmp/compartment/docker-compose.self-hosted.local.yml',
    nodeSocketPath: '/var/run/compartment/node/agent.sock',
  };
}

function createComposeApiService(): Record<
  string,
  string | { PublishedPort: number; TargetPort: number; URL: string }[]
> {
  return {
    Health: 'healthy',
    ID: 'container_api',
    Image: 'ghcr.io/compartmentdev/compartment-api:0.2.0',
    Publishers: [{ PublishedPort: 39444, TargetPort: 39444, URL: '127.0.0.1' }],
    Service: 'api',
    State: 'running',
  };
}

function createComposeNodeService(): Record<string, string | []> {
  return {
    Health: 'healthy',
    ID: 'container_node',
    Image: 'ghcr.io/compartmentdev/compartment-node:0.2.0',
    Publishers: [],
    Service: 'node',
    State: 'running',
  };
}

function createDockerApiInspection(): Record<string, object> {
  return {
    Config: { Image: 'ghcr.io/compartmentdev/compartment-api:0.2.0' },
    NetworkSettings: {
      Ports: {
        '39444/tcp': [{ HostIp: '127.0.0.1', HostPort: '39444' }],
      },
    },
    State: {
      Health: { Status: 'healthy' },
      StartedAt: '2026-04-09T11:00:00.000Z',
      Status: 'running',
    },
  };
}

function createNodeInspection(health: 'healthy' | 'unhealthy'): SelfHostedRuntimeServiceInspection {
  return {
    containerId: null,
    health,
    imageRef: null,
    name: 'node',
    publishedPorts: [],
    startedAt: null,
    status: 'running',
  };
}

function createSuccessfulCommandResult(stdout: string = ''): CommandResult {
  return {
    exitCode: 0,
    stderr: '',
    stdout,
  };
}

function createFailedCommandResult(stderr: string, exitCode: number): CommandResult {
  return {
    exitCode,
    stderr,
    stdout: '',
  };
}

function createDockerExecutionContext(mode: DockerExecutionMode): DockerExecutionContext {
  return {
    dockerCommand: mode === 'direct' ? ['docker'] : ['sudo', 'docker'],
    isRootlessDocker: false,
    mode,
  };
}
