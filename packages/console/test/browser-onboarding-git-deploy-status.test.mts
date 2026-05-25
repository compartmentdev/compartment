import { describe, expect, it } from 'vitest';
import type {
  DeploymentReadSummary,
  DeploymentRuntimeStatus,
  DeploymentStatusResponse,
  GitSourceSyncTask,
} from '@compartment/contracts/browser';
import {
  readDeploymentStatusSnapshot,
  readGitSyncSnapshot,
} from '../src/features/onboarding/onboarding-git-deploy-status';

type TestGitSourceSyncTaskStatus = 'pending' | 'claimed' | 'completed' | 'failed' | 'canceled';

interface DeploymentSummaryOverrides {
  failureMessage?: string | null | undefined;
  isActive?: boolean | undefined;
  status?: DeploymentRuntimeStatus | undefined;
}

interface GitSourceSyncTaskOverrides {
  failureReason?: string | null | undefined;
  status: TestGitSourceSyncTaskStatus;
}

describe('browser onboarding Git deploy status', (): void => {
  it('maps a completed sync with an accepted candidate to the deployment target', (): void => {
    expect(
      readGitSyncSnapshot({
        candidates: [
          {
            blockedReason: null,
            derivedWatchPaths: [],
            descriptorDirectory: 'apps/billing',
            descriptorPath: 'apps/billing/compartment.yml',
            id: 'ssc_123',
            projectName: 'billing',
            status: 'accepted',
          },
        ],
        failureReason: null,
        id: 'sst_123',
        requestedBranchName: 'main',
        resolvedCommitSha: 'sha_123',
        status: 'completed',
      }),
    ).toEqual({ projectName: 'billing' });
  });

  it('maps terminal sync states to onboarding errors', (): void => {
    expect(
      readGitSyncSnapshot(createSyncTask({ failureReason: 'GitHub branch disappeared.', status: 'failed' })),
    ).toEqual({
      state: 'error',
      status: 'terminal_error',
      text: 'GitHub branch disappeared.',
    });
    expect(readGitSyncSnapshot(createSyncTask({ status: 'canceled' }))).toEqual({
      state: 'error',
      status: 'terminal_error',
      text: 'Git repository sync was canceled.',
    });
  });

  it('prioritizes failed deployments before success and pending states', (): void => {
    expect(
      readDeploymentStatusSnapshot(
        createDeploymentStatusResponse([
          createDeployment({ failureMessage: 'Build failed.', status: 'failed' }),
          createDeployment({ isActive: true, status: 'succeeded' }),
        ]),
      ),
    ).toEqual({
      state: 'error',
      status: 'terminal_error',
      text: 'Build failed.',
    });
  });

  it('maps active success and empty deployment lists', (): void => {
    expect(
      readDeploymentStatusSnapshot(
        createDeploymentStatusResponse([createDeployment({ isActive: true, status: 'succeeded' })]),
      ),
    ).toEqual({
      state: 'success',
      status: 'deploy_succeeded',
      text: 'First deploy completed.',
    });
    expect(readDeploymentStatusSnapshot(createDeploymentStatusResponse([]))).toEqual({
      state: 'active',
      status: 'pending',
      text: 'Deployment is queued.',
    });
  });
});

function createSyncTask(overrides: GitSourceSyncTaskOverrides): GitSourceSyncTask {
  return {
    candidates: [],
    failureReason: overrides.failureReason ?? null,
    id: 'sst_123',
    requestedBranchName: 'main',
    resolvedCommitSha: null,
    status: overrides.status,
  };
}

function createDeploymentStatusResponse(deployments: DeploymentReadSummary[]): DeploymentStatusResponse {
  return {
    activeDeployments: deployments.filter((deployment: DeploymentReadSummary): boolean => deployment.isActive),
    deployments,
    environment: {
      name: 'production',
    },
    project: {
      name: 'billing',
    },
  };
}

function createDeployment(overrides: DeploymentSummaryOverrides = {}): DeploymentReadSummary {
  const status: DeploymentRuntimeStatus = overrides.status ?? 'running';
  return {
    completedAt: null,
    createdAt: '2026-05-18T10:00:00.000Z',
    deploymentRunId: 'drn_123',
    failureMessage: overrides.failureMessage ?? null,
    health: status === 'succeeded' ? 'healthy' : 'pending',
    id: 'dep_123',
    isActive: overrides.isActive ?? false,
    label: null,
    operation: {
      completedAt: null,
      createdAt: '2026-05-18T10:00:00.000Z',
      status: status === 'failed' ? 'failed' : 'running',
      type: 'deploy',
    },
    promotionStage: status === 'succeeded' ? 'active' : 'building',
    rollbackAvailable: false,
    routeUrl: null,
    serviceName: 'web',
    status,
  };
}
