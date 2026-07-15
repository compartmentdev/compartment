import { describe, expect, it } from 'vitest';
import type {
  DeployResponse,
  DeploymentLogsResponse,
  DeploymentPromotionStage,
  DeploymentReadSummary,
  DeploymentStatusResponse,
  ResourceSummary,
} from '@compartment/contracts';
import type { CommandProgress, CommandProgressMode } from '../src/commands/command.progress.types';
import {
  createDeployDetachMessage,
  createDeployResultMessage,
  createDeploymentProgressReporter,
  createLogsResultMessage,
  createStatusResultMessage,
} from '../src/commands/deployments/deployment.command.output';
import type { DeploymentStatusReporter, DeploymentStatusView } from '../src/services/deployments.types';
import {
  createActiveDeploymentReadSummaryFixture,
  createDeploymentStatusResponseFixture,
  createDeployResponseFixture,
  createDeploymentSummaryFixture,
  createHistoricalDeploymentStatusResponseFixture,
} from './cli-test.fixtures';

describe('deployment output service', (): void => {
  it('shows deployment duration in the deploy summary', (): void => {
    const response: DeploymentStatusView = createDeploymentStatusResponse({
      completedAt: '2026-03-23T12:00:05.000Z',
      createdAt: '2026-03-23T12:00:00.000Z',
      operationCompletedAt: '2026-03-23T12:00:05.000Z',
      operationCreatedAt: '2026-03-23T12:00:00.000Z',
      routeUrl: 'http://127.0.0.1:31000',
      status: 'succeeded',
    });

    expect(createDeployResultMessage(response)).toBe('Deployment dep_123 is active at http://127.0.0.1:31000 in 5.0s.');
  });

  it('shows deployment labels in summary output', (): void => {
    const response: DeploymentStatusView = createDeploymentStatusResponse({
      completedAt: '2026-03-23T12:00:05.000Z',
      createdAt: '2026-03-23T12:00:00.000Z',
      label: 'release=1;hotfix',
      operationCompletedAt: '2026-03-23T12:00:05.000Z',
      operationCreatedAt: '2026-03-23T12:00:00.000Z',
      routeUrl: 'http://127.0.0.1:31000',
      status: 'succeeded',
    });

    expect(createDeployResultMessage(response)).toBe(
      'Deployment dep_123 [label="release=1;hotfix"] is active at http://127.0.0.1:31000 in 5.0s.',
    );
  });

  it('prints queued deployment ids for detached deploy output', (): void => {
    const response: DeployResponse = createDeployResponseFixture({
      deployments: [
        createDeploymentSummaryFixture({ id: 'dep_web', serviceName: 'web' }),
        createDeploymentSummaryFixture({
          id: 'dep_admin',
          operation: {
            completedAt: null,
            createdAt: '2026-03-30T10:00:00.000Z',
            id: 'op_admin',
            status: 'queued',
            targetId: 'env_123',
            targetType: 'environment',
            type: 'deployment.run',
          },
          serviceName: 'admin',
        }),
      ],
      environment: {
        name: 'production',
      },
    });

    expect(createDeployDetachMessage(response)).toBe(
      'Deployment queued for smoke-web/production. Run: drn_123. Service deployments: web=dep_web, admin=dep_admin. Follow progress with compartment deployment logs --project smoke-web --env production --run drn_123.',
    );
  });

  it('shows verbose deployment details in the status output', (): void => {
    const response: DeploymentStatusView = createDeploymentStatusResponse({
      completedAt: '2026-03-23T12:01:15.000Z',
      createdAt: '2026-03-23T12:00:00.000Z',
      operationCompletedAt: '2026-03-23T12:01:15.000Z',
      operationCreatedAt: '2026-03-23T12:00:00.000Z',
      routeUrl: 'http://127.0.0.1:31000',
      status: 'succeeded',
    });

    const message: string = createStatusResultMessage(response, { verbose: true });

    expect(message).toContain('Deployment dep_123 is succeeded in 1m 15s.');
    expect(message).toContain('Project: smoke-web');
    expect(message).toContain('Environment: production');
    expect(message).toContain('Label: n/a');
    expect(message).toContain('Queued At: 2026-03-23T12:00:00.000Z');
    expect(message).toContain('Failure: n/a');
  });

  it('does not leak inspect-only fields in verbose deployment status output', (): void => {
    const response: DeploymentStatusView = createDeploymentStatusResponse({
      completedAt: '2026-03-23T12:01:15.000Z',
      createdAt: '2026-03-23T12:00:00.000Z',
      operationCompletedAt: '2026-03-23T12:01:15.000Z',
      operationCreatedAt: '2026-03-23T12:00:00.000Z',
      routeUrl: 'http://127.0.0.1:31000',
      status: 'succeeded',
    });

    const message: string = createStatusResultMessage(response, { verbose: true });

    expect(message).not.toContain('Container:');
    expect(message).not.toContain('Operation:');
    expect(message).not.toContain('Readiness:');
    expect(message).not.toContain('Restart Policy:');
    expect(message).not.toContain('Build Packages:');
    expect(message).not.toContain('Runtime Packages:');
  });

  it('does not describe a historical deployment route as active', (): void => {
    const response: DeploymentStatusView = createHistoricalDeploymentStatusResponse();

    expect(createStatusResultMessage(response)).toBe(
      'Deployment dep_123 is succeeded in 4.0s. Recorded route: http://127.0.0.1:31002. No active deployment.\nPod metrics: unavailable.',
    );
  });

  it('shows raw pod CPU and RAM samples in status output', (): void => {
    const response: DeploymentStatusView = createHistoricalDeploymentStatusResponse();
    response.metrics = {
      observedAt: '2026-03-23T12:00:04.000Z',
      pods: [
        {
          cpuMillicores: 12.5,
          deploymentId: 'dep_123',
          memoryBytes: 67_108_864,
          namespace: 'cpt-prj-123',
          observedAt: '2026-03-23T12:00:04.000Z',
          podName: 'web-abc',
          podUid: '11111111-1111-4111-8111-111111111111',
          serviceName: 'web',
        },
      ],
      state: 'available',
    };

    expect(createStatusResultMessage(response)).toContain('web/web-abc: 12.500m CPU, 64.00 MiB RAM');
  });

  it('adds deployment details above log lines in verbose mode', (): void => {
    const response: DeploymentLogsResponse = createDeploymentLogsResponse();

    const message: string = createLogsResultMessage(response, { verbose: true });

    expect(message).toContain('Project: smoke-web');
    expect(message).toContain('Deployment: dep_123');
    expect(message).toContain('2026-03-23T12:00:05.000Z stdout boot complete');
  });

  it('prefixes service names when log output aggregates multiple services', (): void => {
    const message: string = createLogsResultMessage(createAggregateDeploymentLogsResponse());

    expect(message).toContain('2026-03-23T12:00:05.000Z [web] stdout boot complete');
    expect(message).toContain('2026-03-23T12:00:06.000Z [admin] stderr worker warning');
  });

  it('summarizes aggregate deployment status for multiple services', (): void => {
    const message: string = createStatusResultMessage(createAggregateDeploymentStatusResponse(), {
      now: Date.parse('2026-03-23T12:00:05.000Z'),
    });

    expect(message).toBe(
      'Deployments for smoke-web/production: web=succeeded in 5.0s; admin=succeeded in 5.0s.\nPod metrics: unavailable.',
    );
  });

  it('includes resource summaries in aggregate deploy output', (): void => {
    const response: DeploymentStatusResponse & { resources: ResourceSummary[] } = {
      ...createAggregateDeploymentStatusResponse(),
      resources: [createResourceSummary()],
    };

    expect(createDeployResultMessage(response)).toBe(
      'Deployments for smoke-web/production: web active at http://127.0.0.1:31000; admin active at http://127.0.0.1:31001.\nResource postgres is running.',
    );
  });

  it('prints deployment progress updates only when status meaningfully changes for line progress', (): void => {
    const stderr: string[] = [];
    const reporter: DeploymentStatusReporter = createDeploymentProgressReporter({
      now: (): number => Date.parse('2026-03-23T12:00:03.000Z'),
      progress: createTestCommandProgress(stderr),
    });
    const runningResponse: DeploymentStatusResponse = createDeploymentStatusResponse({
      completedAt: null,
      createdAt: '2026-03-23T12:00:00.000Z',
      operationCompletedAt: null,
      operationCreatedAt: '2026-03-23T12:00:00.000Z',
      routeUrl: null,
      status: 'running',
    });
    const succeededResponse: DeploymentStatusResponse = createDeploymentStatusResponse({
      completedAt: '2026-03-23T12:00:05.000Z',
      createdAt: '2026-03-23T12:00:00.000Z',
      operationCompletedAt: '2026-03-23T12:00:05.000Z',
      operationCreatedAt: '2026-03-23T12:00:00.000Z',
      promotionStage: 'active',
      routeUrl: 'http://127.0.0.1:31000',
      status: 'succeeded',
    });

    reporter(runningResponse);
    reporter(runningResponse);
    reporter(succeededResponse);

    expect(stderr).toEqual([
      'Deploy smoke-web/production web: running (building), elapsed 3.0s.\n',
      'Deploy smoke-web/production web: succeeded (active) in 5.0s. Route: http://127.0.0.1:31000.\n',
    ]);
  });

  it('refreshes live deployment progress when elapsed time changes', (): void => {
    const stderr: string[] = [];
    let now: number = Date.parse('2026-03-23T12:00:03.000Z');
    const reporter: DeploymentStatusReporter = createDeploymentProgressReporter({
      now: (): number => now,
      progress: createTestCommandProgress(stderr, 'live'),
    });
    const runningResponse: DeploymentStatusResponse = createDeploymentStatusResponse({
      completedAt: null,
      createdAt: '2026-03-23T12:00:00.000Z',
      operationCompletedAt: null,
      operationCreatedAt: '2026-03-23T12:00:00.000Z',
      routeUrl: null,
      status: 'running',
    });

    reporter(runningResponse);
    reporter(runningResponse);
    now = Date.parse('2026-03-23T12:00:04.000Z');
    reporter(runningResponse);

    expect(stderr).toEqual([
      'Deploy smoke-web/production web: running (building), elapsed 3.0s.\n',
      'Deploy smoke-web/production web: running (building), elapsed 4.0s.\n',
    ]);
  });

  it('includes labels in deployment progress output', (): void => {
    const stderr: string[] = [];
    const reporter: DeploymentStatusReporter = createDeploymentProgressReporter({
      now: (): number => Date.parse('2026-03-23T12:00:03.000Z'),
      progress: createTestCommandProgress(stderr),
    });
    const runningResponse: DeploymentStatusResponse = createDeploymentStatusResponse({
      completedAt: null,
      createdAt: '2026-03-23T12:00:00.000Z',
      label: 'release=1;hotfix',
      operationCompletedAt: null,
      operationCreatedAt: '2026-03-23T12:00:00.000Z',
      routeUrl: null,
      status: 'running',
    });

    reporter(runningResponse);

    expect(stderr).toEqual([
      'Deploy smoke-web/production web [label="release=1;hotfix"]: running (building), elapsed 3.0s.\n',
    ]);
  });

  it('shows the release stage in progress output', (): void => {
    const response: DeploymentStatusResponse = createDeploymentStatusResponse({
      completedAt: null,
      createdAt: '2026-03-23T12:00:00.000Z',
      operationCompletedAt: null,
      operationCreatedAt: '2026-03-23T12:00:00.000Z',
      promotionStage: 'release',
      routeUrl: null,
      status: 'running',
    });
    const stderr: string[] = [];
    const reporter: DeploymentStatusReporter = createDeploymentProgressReporter({
      now: (): number => Date.parse('2026-03-23T12:00:03.000Z'),
      progress: createTestCommandProgress(stderr),
    });

    reporter(response);

    expect(stderr).toEqual(['Deploy smoke-web/production web: running (release), elapsed 3.0s.\n']);
  });
});

interface CreateDeploymentStatusResponseInput {
  completedAt: string | null;
  createdAt: string;
  label?: string | null;
  operationCompletedAt: string | null;
  operationCreatedAt: string;
  promotionStage?: DeploymentPromotionStage | undefined;
  routeUrl: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
}

function createDeploymentStatusResponse(input: CreateDeploymentStatusResponseInput): DeploymentStatusView {
  const deployment: DeploymentReadSummary = createActiveDeploymentReadSummaryFixture({
    completedAt: input.completedAt,
    createdAt: input.createdAt,
    isActive: input.status === 'succeeded',
    label: input.label ?? null,
    operation: {
      completedAt: input.operationCompletedAt,
      createdAt: input.operationCreatedAt,
      status: input.status,
      type: 'deployment.create',
    },
    promotionStage: input.promotionStage ?? 'building',
    routeUrl: input.routeUrl,
    status: input.status,
  });

  return {
    ...createDeploymentStatusResponseFixture({
      activeDeployments: deployment.isActive ? [deployment] : [],
      deployments: [deployment],
      environment: {
        name: 'production',
      },
    }),
    metrics: { observedAt: null, pods: [], state: 'unavailable' },
  };
}

function createDeploymentLogsResponse(): DeploymentLogsResponse {
  const deployment: DeploymentReadSummary = createDeploymentStatusResponse({
    completedAt: '2026-03-23T12:00:05.000Z',
    createdAt: '2026-03-23T12:00:00.000Z',
    operationCompletedAt: '2026-03-23T12:00:05.000Z',
    operationCreatedAt: '2026-03-23T12:00:00.000Z',
    routeUrl: 'http://127.0.0.1:31000',
    status: 'succeeded',
  }).deployments[0]!;

  return {
    deployments: [deployment],
    environment: {
      name: 'production',
    },
    lines: [
      {
        deploymentId: 'dep_123',
        environmentName: 'production',
        message: 'boot complete',
        serviceName: 'web',
        stream: 'stdout',
        timestamp: '2026-03-23T12:00:05.000Z',
      },
    ],
    project: {
      name: 'smoke-web',
    },
  };
}

function createHistoricalDeploymentStatusResponse(): DeploymentStatusView {
  return {
    ...createHistoricalDeploymentStatusResponseFixture({
      deployment: {
        completedAt: '2026-03-23T12:00:04.000Z',
        createdAt: '2026-03-23T12:00:00.000Z',
        health: 'unhealthy',
        operation: {
          completedAt: '2026-03-23T12:00:04.000Z',
          createdAt: '2026-03-23T12:00:00.000Z',
          status: 'succeeded',
        },
        routeUrl: 'http://127.0.0.1:31002',
        status: 'succeeded',
      },
      environment: {
        name: 'production',
      },
      project: {
        name: 'smoke-web',
      },
    }),
    metrics: { observedAt: null, pods: [], state: 'unavailable' },
  };
}

function createAggregateDeploymentLogsResponse(): DeploymentLogsResponse {
  const webDeployment: DeploymentReadSummary = createDeploymentStatusResponse({
    completedAt: '2026-03-23T12:00:05.000Z',
    createdAt: '2026-03-23T12:00:00.000Z',
    operationCompletedAt: '2026-03-23T12:00:05.000Z',
    operationCreatedAt: '2026-03-23T12:00:00.000Z',
    routeUrl: 'http://127.0.0.1:31000',
    status: 'succeeded',
  }).deployments[0]!;
  const adminDeployment: DeploymentReadSummary = {
    ...webDeployment,
    id: 'dep_456',
    routeUrl: 'http://127.0.0.1:31001',
    serviceName: 'admin',
  };

  return {
    deployments: [webDeployment, adminDeployment],
    environment: {
      name: 'production',
    },
    lines: [
      {
        deploymentId: 'dep_123',
        environmentName: 'production',
        message: 'boot complete',
        serviceName: 'web',
        stream: 'stdout',
        timestamp: '2026-03-23T12:00:05.000Z',
      },
      {
        deploymentId: 'dep_456',
        environmentName: 'production',
        message: 'worker warning',
        serviceName: 'admin',
        stream: 'stderr',
        timestamp: '2026-03-23T12:00:06.000Z',
      },
    ],
    project: {
      name: 'smoke-web',
    },
  };
}

function createAggregateDeploymentStatusResponse(): DeploymentStatusView {
  const webDeployment: DeploymentReadSummary = createDeploymentStatusResponse({
    completedAt: '2026-03-23T12:00:05.000Z',
    createdAt: '2026-03-23T12:00:00.000Z',
    operationCompletedAt: '2026-03-23T12:00:05.000Z',
    operationCreatedAt: '2026-03-23T12:00:00.000Z',
    routeUrl: 'http://127.0.0.1:31000',
    status: 'succeeded',
  }).deployments[0]!;
  const adminDeployment: DeploymentReadSummary = {
    ...webDeployment,
    id: 'dep_456',
    routeUrl: 'http://127.0.0.1:31001',
    serviceName: 'admin',
  };

  return {
    activeDeployments: [webDeployment, adminDeployment],
    deployments: [webDeployment, adminDeployment],
    environment: {
      name: 'production',
    },
    metrics: { observedAt: null, pods: [], state: 'unavailable' },
    project: {
      name: 'smoke-web',
    },
  };
}

function createResourceSummary(): ResourceSummary {
  return {
    createdAt: '2026-03-23T12:00:00.000Z',
    env: [],
    id: 'res_123',
    image: 'postgres:16',
    name: 'postgres',
    ports: [5432],
    readiness: null,
    status: 'running',
    updatedAt: '2026-03-23T12:00:00.000Z',
    volumes: [],
  };
}

function createTestCommandProgress(stderr: string[], mode: CommandProgressMode = 'line'): CommandProgress {
  return new TestCommandProgress(stderr, mode);
}

class TestCommandProgress implements CommandProgress {
  readonly mode: CommandProgressMode;
  readonly #stderr: string[];

  constructor(stderr: string[], mode: CommandProgressMode) {
    this.#stderr = stderr;
    this.mode = mode;
  }

  report(message: string): void {
    this.#stderr.push(`${message}\n`);
  }

  stop(): void {
    return;
  }
}
