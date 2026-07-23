import { describe, expect, it } from 'vitest';
import type { DeploymentRunLogsResponse } from '@compartment/contracts';
import { createDeploymentRunLogsResultMessage } from '../src/services/deployment-run-logs-output.service';

describe('deployment run logs output service', (): void => {
  it('marks latest failed deployment logs before the event trail', (): void => {
    const response: DeploymentRunLogsResponse = {
      deployment: {
        completedAt: '2026-07-23T12:01:00.000Z',
        createdAt: '2026-07-23T12:00:00.000Z',
        failureMessage: 'Kubernetes rollout timed out.',
        id: 'drn_failed',
        label: null,
        status: 'failed',
        trigger: {
          branchName: null,
          commitSha: null,
          repositoryName: null,
          repositoryOwner: null,
          sourceEventId: null,
          sourceResolutionTaskId: null,
          type: 'manual',
        },
      },
      deployments: [],
      environment: { name: 'production' },
      lines: [
        {
          deploymentId: 'dep_failed',
          level: 'error',
          message: 'Kubernetes rollout timed out.',
          serviceName: 'internal-api',
          stepKey: 'release',
          stream: 'compartment',
          timestamp: '2026-07-23T12:01:00.000Z',
        },
      ],
      project: { name: 'multi-service' },
      steps: [],
    };

    expect(createDeploymentRunLogsResultMessage(response)).toBe(
      'Showing logs of failed deployment run drn_failed from 2026-07-23T12:00:00.000Z.\n' +
        '2026-07-23T12:01:00.000Z [internal-api] compartment Kubernetes rollout timed out.',
    );
  });
});
