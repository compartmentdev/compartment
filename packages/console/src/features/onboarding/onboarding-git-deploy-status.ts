import type {
  DeploymentReadSummary,
  DeploymentStatusResponse,
  GitSourceSyncCandidate,
  GitSourceSyncTask,
} from '@compartment/contracts/browser';
import type { OnboardingStatusState } from './onboarding-shared';

export type GitDeployStatusKey = 'deploy_succeeded' | 'pending' | 'terminal_error';

export interface GitDeployStatusSnapshot {
  state: OnboardingStatusState;
  status: GitDeployStatusKey;
  text: string;
}

export interface GitSyncTarget {
  projectName: string;
}

export function readGitSyncSnapshot(task: GitSourceSyncTask): GitDeployStatusSnapshot | GitSyncTarget {
  if (task.status === 'failed') {
    return createGitDeploySnapshot('error', 'terminal_error', task.failureReason ?? 'Git repository sync failed.');
  }
  if (task.status === 'canceled') {
    return createGitDeploySnapshot('error', 'terminal_error', 'Git repository sync was canceled.');
  }
  if (task.status !== 'completed') {
    return createGitDeploySnapshot('active', 'pending', 'Syncing repository from Git.');
  }

  const acceptedCandidate: GitSourceSyncCandidate | undefined = task.candidates.find(
    (candidate: GitSourceSyncCandidate): boolean => candidate.status === 'accepted' && candidate.projectName !== null,
  );
  const acceptedProjectName: string | null | undefined = acceptedCandidate?.projectName;
  if (acceptedProjectName === undefined || acceptedProjectName === null) {
    return createGitDeploySnapshot('error', 'terminal_error', readBlockedSyncMessage(task));
  }

  return { projectName: acceptedProjectName };
}

export function readDeploymentStatusSnapshot(response: DeploymentStatusResponse): GitDeployStatusSnapshot {
  const failedDeployment: DeploymentReadSummary | undefined = response.deployments.find(
    (deployment: DeploymentReadSummary): boolean => deployment.status === 'failed',
  );
  if (failedDeployment !== undefined) {
    return createGitDeploySnapshot(
      'error',
      'terminal_error',
      failedDeployment.failureMessage ?? 'First deploy failed.',
    );
  }
  if (
    response.activeDeployments.some((deployment: DeploymentReadSummary): boolean => deployment.status === 'succeeded')
  ) {
    return createGitDeploySnapshot('success', 'deploy_succeeded', 'First deploy completed.');
  }
  if (response.deployments.length === 0) {
    return createGitDeploySnapshot('active', 'pending', 'Deployment is queued.');
  }
  return createGitDeploySnapshot('active', 'pending', 'Deploying services.');
}

function readBlockedSyncMessage(task: GitSourceSyncTask): string {
  const blockedCandidate: GitSourceSyncCandidate | undefined = task.candidates.find(
    (candidate: GitSourceSyncCandidate): boolean => candidate.status === 'blocked',
  );
  return blockedCandidate?.blockedReason ?? 'Git source synced, but no deployable descriptor was adopted.';
}

function createGitDeploySnapshot(
  state: OnboardingStatusState,
  status: GitDeployStatusKey,
  text: string,
): GitDeployStatusSnapshot {
  return {
    state,
    status,
    text,
  };
}
