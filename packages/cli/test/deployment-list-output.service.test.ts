import { describe, expect, it } from 'vitest';
import type { DeploymentListResponse, DeploymentReadSummary } from '@compartment/contracts';
import { createDeploymentListMessage } from '../src/services/deployment-list-output.service';

describe('deployment list output service', (): void => {
  it('groups deployment rows under deployment runs', (): void => {
    const message: string = createDeploymentListMessage(
      createDeploymentListResponse([
        createDeploymentSummary({
          createdAt: '2026-03-30T15:34:02.906Z',
          deploymentRunId: 'drn_grouped',
          id: 'dep_web',
          isActive: true,
          label: 'release 42',
          serviceName: 'web',
          status: 'succeeded',
        }),
        createDeploymentSummary({
          createdAt: '2026-03-30T15:34:02.906Z',
          deploymentRunId: 'drn_grouped',
          id: 'dep_backoffice',
          isActive: false,
          label: 'release 42',
          serviceName: 'backoffice',
          status: 'succeeded',
        }),
      ]),
      'production',
    );

    expect(message).toContain('run drn_grouped');
    expect(message).toContain('release 42');
    expect(message).toContain('2 services');
    expect(message).toContain('  dep_web');
    expect(message).toContain('  dep_backoffice');
  });

  it('does not print rollback retention or reusable image state in deployment list output', (): void => {
    const message: string = createDeploymentListMessage(
      createDeploymentListResponse([
        createDeploymentSummary({
          createdAt: '2026-03-30T15:34:02.906Z',
          id: 'dep_web',
          isActive: true,
          serviceName: 'web',
          status: 'succeeded',
        }),
      ]),
      'production',
    );

    expect(message).not.toContain('Rollback retention:');
    expect(message).not.toContain('available');
  });

  it('pads short service names to a fixed-width column inside run groups', (): void => {
    const message: string = createDeploymentListMessage(
      createDeploymentListResponse([
        createDeploymentSummary({
          createdAt: '2026-03-30T15:34:02.906Z',
          deploymentRunId: 'drn_grouped',
          id: 'dep_24bb92b3e79b4e0c839d45c06d35f267',
          isActive: true,
          serviceName: 'web',
          status: 'succeeded',
        }),
        createDeploymentSummary({
          createdAt: '2026-03-30T15:30:13.481Z',
          deploymentRunId: 'drn_grouped',
          id: 'dep_898aa24ea5e243fa955428f377f7c54a',
          isActive: false,
          serviceName: 'backoffice',
          status: 'succeeded',
        }),
      ]),
      'production',
    );
    const lines: string[] = readDeploymentRows(message);
    const firstSucceededIndex: number = lines[0]!.indexOf('succeeded');
    const secondSucceededIndex: number = lines[1]!.indexOf('succeeded');
    const firstStageIndex: number = lines[0]!.indexOf('active');
    const secondStageIndex: number = lines[1]!.indexOf('active');

    expect(firstSucceededIndex).toBe(secondSucceededIndex);
    expect(firstStageIndex).toBe(secondStageIndex);
    expect(lines.some((line: string): boolean => line.includes('web                 '))).toBe(true);
    expect(lines.some((line: string): boolean => line.includes('backoffice          '))).toBe(true);
  });

  it('truncates long service names so the status column stays aligned inside run groups', (): void => {
    const message: string = createDeploymentListMessage(
      createDeploymentListResponse([
        createDeploymentSummary({
          createdAt: '2026-03-30T15:34:02.906Z',
          id: 'dep_24bb92b3e79b4e0c839d45c06d35f267',
          isActive: true,
          serviceName: 'service-name-that-is-far-too-long',
          status: 'succeeded',
        }),
      ]),
      'production',
    );

    expect(message).toContain('service-name-that...');
    expect(message).not.toContain('service-name-that-is-far-too-long');
  });

  it('prints a short failed deployment summary from the first failure line', (): void => {
    const message: string = createDeploymentListMessage(
      createDeploymentListResponse([
        createDeploymentSummary({
          createdAt: '2026-03-30T15:34:02.906Z',
          failureMessage:
            'build step failed because the Dockerfile referenced a missing base image tag\nsecondary line is ignored',
          id: 'dep_failed',
          isActive: false,
          serviceName: 'worker',
          status: 'failed',
        }),
      ]),
      'production',
    );

    expect(message).toContain('rolled_back');
    expect(message).toContain('build step failed because the Dockerfile referenced a missing base image tag');
    expect(message).not.toContain('secondary line is ignored');
  });

  it('prints deployment labels in a fixed-width column', (): void => {
    const message: string = createDeploymentListMessage(
      createDeploymentListResponse([
        createDeploymentSummary({
          createdAt: '2026-03-30T15:34:02.906Z',
          id: 'dep_24bb92b3e79b4e0c839d45c06d35f267',
          isActive: true,
          label: 'hotfix auth',
          serviceName: 'web',
          status: 'succeeded',
        }),
      ]),
      'production',
    );

    expect(message).toContain('hotfix auth');
  });

  it('keeps the label column out when no deployment has a label', (): void => {
    const messageWithoutLabels: string = createDeploymentListMessage(
      createDeploymentListResponse([
        createDeploymentSummary({
          createdAt: '2026-03-30T15:34:02.906Z',
          id: 'dep_24bb92b3e79b4e0c839d45c06d35f267',
          isActive: true,
          serviceName: 'web',
          status: 'succeeded',
        }),
      ]),
      'production',
    );
    const messageWithLabels: string = createDeploymentListMessage(
      createDeploymentListResponse([
        createDeploymentSummary({
          createdAt: '2026-03-30T15:34:02.906Z',
          id: 'dep_24bb92b3e79b4e0c839d45c06d35f267',
          isActive: true,
          label: 'hotfix auth',
          serviceName: 'web',
          status: 'succeeded',
        }),
      ]),
      'production',
    );
    const rowsWithoutLabels: string[] = readDeploymentRows(messageWithoutLabels);
    const rowsWithLabels: string[] = readDeploymentRows(messageWithLabels);

    expect(rowsWithoutLabels[0]!.indexOf('succeeded')).toBeLessThan(rowsWithLabels[0]!.indexOf('succeeded'));
  });

  it('pads and truncates labels without shifting the status column', (): void => {
    const message: string = createDeploymentListMessage(
      createDeploymentListResponse([
        createDeploymentSummary({
          createdAt: '2026-03-30T15:34:02.906Z',
          id: 'dep_24bb92b3e79b4e0c839d45c06d35f267',
          isActive: true,
          label: 'candidate',
          serviceName: 'web',
          status: 'succeeded',
        }),
        createDeploymentSummary({
          createdAt: '2026-03-30T15:30:13.481Z',
          id: 'dep_898aa24ea5e243fa955428f377f7c54a',
          isActive: false,
          label: 'label-that-is-far-too-long-for-the-column',
          serviceName: 'backoffice',
          status: 'succeeded',
        }),
      ]),
      'production',
    );
    const lines: string[] = readDeploymentRows(message);
    const firstSucceededIndex: number = lines[0]!.indexOf('succeeded');
    const secondSucceededIndex: number = lines[1]!.indexOf('succeeded');

    expect(firstSucceededIndex).toBe(secondSucceededIndex);
    expect(lines[1]).toContain('label-that-is-far-too...');
  });

  it('redacts failed deployment summaries that expose internal diagnostics', (): void => {
    const message: string = createDeploymentListMessage(
      createDeploymentListResponse([
        createDeploymentSummary({
          createdAt: '2026-03-30T15:34:02.906Z',
          failureMessage: 'build failed with details at /tmp/compartment/build/context.json',
          id: 'dep_failed',
          isActive: false,
          serviceName: 'worker',
          status: 'failed',
        }),
      ]),
      'production',
    );

    expect(message).toContain('internal error');
    expect(message).not.toContain('/tmp/compartment/build/context.json');
  });

  it('redacts failed deployment summaries that expose filesystem paths from common runtime roots', (): void => {
    const message: string = createDeploymentListMessage(
      createDeploymentListResponse([
        createDeploymentSummary({
          createdAt: '2026-03-30T15:34:02.906Z',
          failureMessage: 'runtime crashed while reading /app/dist/server.js',
          id: 'dep_failed',
          isActive: false,
          serviceName: 'worker',
          status: 'failed',
        }),
      ]),
      'production',
    );

    expect(message).toContain('internal error');
    expect(message).not.toContain('/app/dist/server.js');
  });

  it('keeps safe runtime failure summaries visible in deployment list output', (): void => {
    const message: string = createDeploymentListMessage(
      createDeploymentListResponse([
        createDeploymentSummary({
          createdAt: '2026-03-30T15:34:02.906Z',
          failureMessage: '[vite] GET /healthz returned 500',
          id: 'dep_failed',
          isActive: false,
          serviceName: 'worker',
          status: 'failed',
        }),
      ]),
      'production',
    );

    expect(message).toContain('[vite] GET /healthz returned 500');
    expect(message).not.toContain('internal error');
  });

  it('truncates safe failed deployment summaries to 80 characters', (): void => {
    const failureSummary: string = 'a'.repeat(90);
    const message: string = createDeploymentListMessage(
      createDeploymentListResponse([
        createDeploymentSummary({
          createdAt: '2026-03-30T15:34:02.906Z',
          failureMessage: failureSummary,
          id: 'dep_failed',
          isActive: false,
          serviceName: 'worker',
          status: 'failed',
        }),
      ]),
      'production',
    );

    expect(message.endsWith(`${'a'.repeat(77)}...`)).toBe(true);
    expect(message).not.toContain(failureSummary);
  });
});

interface CreateDeploymentSummaryInput {
  createdAt: string;
  deploymentRunId?: string | undefined;
  failureMessage?: string | undefined;
  id: string;
  isActive: boolean;
  label?: string | null;
  serviceName: string;
  status: 'failed' | 'running' | 'succeeded';
}

function readDeploymentRows(message: string): string[] {
  return message.split('\n').filter((line: string): boolean => line.startsWith('  dep_'));
}

type DeploymentFixturePromotionStage = 'active' | 'building' | 'rolled_back';
type DeploymentFixtureStatus = 'failed' | 'running' | 'succeeded';

function createDeploymentListResponse(deployments: DeploymentReadSummary[]): DeploymentListResponse {
  return {
    deployments,
    environment: {
      name: 'production',
    },
    project: {
      name: 'smoke-multi-service',
    },
  };
}

function createDeploymentSummary(input: CreateDeploymentSummaryInput): DeploymentReadSummary {
  return {
    completedAt: input.status === 'succeeded' ? input.createdAt : null,
    createdAt: input.createdAt,
    deploymentRunId: input.deploymentRunId ?? `drn_${input.id}`,
    failureMessage: input.failureMessage ?? null,
    health: input.status === 'succeeded' ? 'healthy' : 'pending',
    id: input.id,
    isActive: input.isActive,
    label: input.label ?? null,
    operation: {
      completedAt: input.status === 'succeeded' ? input.createdAt : null,
      createdAt: input.createdAt,
      status: input.status,
      type: 'deployment.create',
    },
    promotionStage: createPromotionStage(input.status),
    rollbackAvailable: input.status === 'succeeded' && input.isActive === false,
    routeUrl: input.status === 'succeeded' ? 'http://service.localhost' : null,
    serviceName: input.serviceName,
    status: input.status,
  };
}

function createPromotionStage(status: DeploymentFixtureStatus): DeploymentFixturePromotionStage {
  switch (status) {
    case 'failed':
      return 'rolled_back';
    case 'running':
      return 'building';
    case 'succeeded':
      return 'active';
  }
}
