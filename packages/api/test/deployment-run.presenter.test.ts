import { describe, expect, it } from 'vitest';
import type { DeploymentRunLogsResponse, DeploymentRuntimeStatus } from '@compartment/contracts';
import { buildDeploymentRunLogsResponse } from '../src/routes/deployments/deployment-run.presenter';
import type { DeploymentJoinedRow } from '../src/queries/deployments.query.types';
import type { DeploymentRunLogsResponseInput } from '../src/services/presenter.types';

describe('buildDeploymentRunLogsResponse', (): void => {
  it('keeps the run status failed when a filtered service deployment succeeded', (): void => {
    const response: DeploymentRunLogsResponse = buildDeploymentRunLogsResponse(
      createDeploymentRunLogsResponseInput({
        runDeployments: [
          createDeploymentJoinedRow('web', 'succeeded', '2026-04-30T18:11:03.109Z'),
          createDeploymentJoinedRow('backoffice', 'failed', '2026-04-30T18:11:05.000Z', 'readiness failed'),
        ],
      }),
    );

    expect(response.deployments).toHaveLength(1);
    expect(response.deployments[0]?.serviceName).toBe('web');
    expect(response.deployment.status).toBe('failed');
    expect(response.deployment.failureMessage).toBe('readiness failed');
  });

  it('keeps the run incomplete when another deployment in the run is still running', (): void => {
    const response: DeploymentRunLogsResponse = buildDeploymentRunLogsResponse(
      createDeploymentRunLogsResponseInput({
        runDeployments: [
          createDeploymentJoinedRow('web', 'succeeded', '2026-04-30T18:11:03.109Z'),
          createDeploymentJoinedRow('backoffice', 'running', null),
        ],
      }),
    );

    expect(response.deployments).toHaveLength(1);
    expect(response.deployments[0]?.serviceName).toBe('web');
    expect(response.deployment.status).toBe('running');
    expect(response.deployment.completedAt).toBeNull();
  });

  it('reads trigger fields only from valid JSON objects with string values', (): void => {
    const input: DeploymentRunLogsResponseInput = createDeploymentRunLogsResponseInput({
      runDeployments: [createDeploymentJoinedRow('web', 'succeeded', '2026-04-30T18:11:03.109Z')],
    });
    input.run.sourceBindingSnapshotJson = JSON.stringify({ branchName: 'main', ignored: true });
    input.run.sourceRepositorySnapshotJson = JSON.stringify({
      repositoryName: 'compartment',
      repositoryOwner: 'openai',
    });

    expect(buildDeploymentRunLogsResponse(input).deployment.trigger).toMatchObject({
      branchName: 'main',
      repositoryName: 'compartment',
      repositoryOwner: 'openai',
    });

    input.run.sourceBindingSnapshotJson = '[]';
    input.run.sourceRepositorySnapshotJson = '{"repositoryName":42';

    expect(buildDeploymentRunLogsResponse(input).deployment.trigger).toMatchObject({
      branchName: null,
      repositoryName: null,
      repositoryOwner: null,
    });
  });
});

function createDeploymentRunLogsResponseInput(input: {
  runDeployments: DeploymentJoinedRow[];
}): DeploymentRunLogsResponseInput {
  return {
    deployments: [input.runDeployments[0]!],
    environmentName: 'production',
    lineEvents: [],
    projectName: 'smoke-web',
    run: {
      createdAt: new Date('2026-04-30T18:10:11.991Z'),
      id: 'drn_123',
      label: 'deploy',
      sourceBindingSnapshotJson: null,
      sourceCommitSha: null,
      sourceEventId: null,
      sourceRepositorySnapshotJson: null,
      sourceResolutionTaskId: null,
      triggerType: 'manual',
    },
    runDeployments: input.runDeployments,
    stepEvents: [],
  };
}

function createDeploymentJoinedRow(
  serviceName: string,
  status: DeploymentRuntimeStatus,
  completedAt: string | null,
  failureMessage: string | null = null,
): DeploymentJoinedRow {
  const now: Date = new Date('2026-04-30T18:10:11.991Z');

  return {
    artifact: {
      createdAt: now,
      createdByPrincipalId: null,
      id: `art_${serviceName}`,
      imageRef: null,
      imageRepository: `registry.example/${serviceName}`,
      imageRetentionState: 'available',
      imageCleanedAt: null,
      projectId: 'prj_123',
      projectServiceId: `svc_${serviceName}`,
      resolvedBuildEnvJson: '{}',
      resolvedBuildJson: '{}',
      sourceDigest: 'sha256:source',
      sourceUploadId: null,
      updatedAt: now,
    },
    deployment: {
      accessMode: 'public',
      buildArtifactId: `art_${serviceName}`,
      completedAt: completedAt === null ? null : new Date(completedAt),
      createdAt: now,
      deploymentRunId: 'drn_123',
      environmentId: 'env_123',
      failureMessage,
      health: readDeploymentHealth(status, failureMessage),
      id: `dep_${serviceName}`,
      isActive: status === 'succeeded',
      label: null,
      movementSourceDeploymentId: null,
      operationId: `op_${serviceName}`,
      projectServiceId: `svc_${serviceName}`,
      promotionStage: readDeploymentPromotionStage(status),
      resolvedReadinessJson: '{}',
      resolvedReleaseJson: 'null',
      resolvedRoutesJson: '[]',
      resolvedRunJson: '{}',
      routeBaseDomain: 'localhost',
      routeHost: null,
      sourceAutomationPrincipalId: null,
      sourceBindingId: null,
      sourceBindingSnapshotJson: null,
      sourceCommitSha: null,
      sourceEventId: null,
      sourceId: null,
      sourceKind: null,
      sourceRepositorySnapshotJson: null,
      sourceResolutionTaskId: null,
      status,
      updatedAt: now,
    },
    environment: {
      createdAt: now,
      id: 'env_123',
      name: 'production',
      projectId: 'prj_123',
      updatedAt: now,
    },
    operation: {
      actorPrincipalId: null,
      completedAt: completedAt === null ? null : new Date(completedAt),
      createdAt: now,
      id: `op_${serviceName}`,
      status: failureMessage === null ? 'succeeded' : 'failed',
      summary: failureMessage ?? 'deployment completed',
      targetId: `dep_${serviceName}`,
      targetType: 'deployment',
      type: 'deploy',
    },
    project: {
      archivedAt: null,
      createdAt: now,
      id: 'prj_123',
      name: 'smoke-web',
      organizationId: 'org_123',
      updatedAt: now,
    },
    service: {
      createdAt: now,
      id: `svc_${serviceName}`,
      kind: 'web',
      name: serviceName,
      path: '.',
      projectId: 'prj_123',
      updatedAt: now,
    },
  };
}

function readDeploymentHealth(
  status: DeploymentRuntimeStatus,
  failureMessage: string | null,
): 'healthy' | 'pending' | 'unhealthy' {
  if (failureMessage !== null || status === 'failed') {
    return 'unhealthy';
  }

  return status === 'running' ? 'pending' : 'healthy';
}

function readDeploymentPromotionStage(status: DeploymentRuntimeStatus): 'active' | 'release' | 'stopped' {
  switch (status) {
    case 'running':
      return 'release';
    case 'stopped':
      return 'stopped';
    case 'failed':
    case 'queued':
    case 'succeeded':
      return 'active';
  }
}
