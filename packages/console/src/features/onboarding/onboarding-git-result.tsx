import { useCallback, useEffect, useState, type JSX } from 'react';
import type { GitSourceSyncTaskResponse } from '@compartment/contracts/browser';
import { GitDeploySummary } from './onboarding-git-deploy-summary';
import {
  readDeploymentStatusSnapshot,
  readGitSyncSnapshot,
  type GitDeployStatusKey,
  type GitDeployStatusSnapshot,
  type GitSyncTarget,
} from './onboarding-git-deploy-status';
import { readBrowserDeploymentStatus, readBrowserGitSourceSyncTask } from './onboarding-git-api';
import type { OnboardingRouteState } from './onboarding-page.types';
import { OnboardingStatus, type OnboardingStatusState } from './onboarding-shared';
import { onboardingStatusPollingIntervalMs } from './onboarding-status-polling';

interface GitDeployStepProps {
  onCompleted: () => void;
  routeState: OnboardingRouteState;
  selectedOrganizationSlug: string;
}

interface GitDeployStatusView {
  refresh: () => Promise<void>;
  state: OnboardingStatusState;
  text: string;
}

class GitDeployStatusViewValue implements GitDeployStatusView {
  public constructor(
    public readonly refresh: () => Promise<void>,
    public readonly state: OnboardingStatusState,
    public readonly text: string,
  ) {}
}

export function GitDeployStep({
  onCompleted,
  routeState,
  selectedOrganizationSlug,
}: Readonly<GitDeployStepProps>): JSX.Element {
  const status: GitDeployStatusView = useGitDeployStatus(selectedOrganizationSlug, routeState);
  useGitDeployCompletion(status, onCompleted);
  return (
    <div className="grid gap-5 p-5">
      <h2 className="text-[24px] font-semibold leading-8">Waiting for first deploy</h2>
      <GitDeploySummary routeState={routeState} />
      <OnboardingStatus
        label="Deployment"
        onRefresh={status.refresh}
        selectedOrganizationSlug={selectedOrganizationSlug}
        showOpenProjectsOnSuccess={true}
        state={status.state}
        value={status.text}
      />
    </div>
  );
}

function useGitDeployCompletion(status: GitDeployStatusView, onCompleted: () => void): void {
  useEffect((): void => {
    if (status.state === 'success') {
      onCompleted();
    }
  }, [onCompleted, status.state]);
}

function useGitDeployStatus(selectedOrganizationSlug: string, routeState: OnboardingRouteState): GitDeployStatusView {
  const [snapshot, setSnapshot] = useState<GitDeployStatusSnapshot>({
    state: 'active',
    status: 'pending',
    text: 'Checking Git sync status.',
  });
  const refresh: () => Promise<void> = useGitDeployStatusRefresh(
    selectedOrganizationSlug,
    routeState.environmentName,
    routeState.sourceId,
    routeState.syncTaskId,
    setSnapshot,
  );
  useGitDeployStatusPolling(routeState.sourceId, routeState.syncTaskId, snapshot.status, refresh);

  return new GitDeployStatusViewValue(refresh, snapshot.state, snapshot.text);
}

function useGitDeployStatusRefresh(
  selectedOrganizationSlug: string,
  environmentName: string | undefined,
  sourceId: string | undefined,
  syncTaskId: string | undefined,
  setSnapshot: (snapshot: GitDeployStatusSnapshot) => void,
): () => Promise<void> {
  return useCallback(async (): Promise<void> => {
    setSnapshot(await readGitDeployStatusSnapshot(selectedOrganizationSlug, environmentName, sourceId, syncTaskId));
  }, [environmentName, selectedOrganizationSlug, setSnapshot, sourceId, syncTaskId]);
}

function useGitDeployStatusPolling(
  sourceId: string | undefined,
  syncTaskId: string | undefined,
  status: GitDeployStatusKey,
  refresh: () => Promise<void>,
): void {
  useEffect((): (() => void) | undefined => {
    if (sourceId === undefined || syncTaskId === undefined || status !== 'pending') {
      return undefined;
    }
    void refresh();
    const intervalId: number = window.setInterval((): void => {
      void refresh();
    }, onboardingStatusPollingIntervalMs);
    return (): void => {
      window.clearInterval(intervalId);
    };
  }, [refresh, sourceId, status, syncTaskId]);
}

async function readGitDeployStatusSnapshot(
  selectedOrganizationSlug: string,
  environmentName: string | undefined,
  sourceId: string | undefined,
  syncTaskId: string | undefined,
): Promise<GitDeployStatusSnapshot> {
  if (sourceId === undefined || syncTaskId === undefined) {
    return createGitDeploySnapshot('idle', 'pending', 'Waiting for Git source connection.');
  }

  const syncResponse: GitSourceSyncTaskResponse = await readBrowserGitSourceSyncTask(
    selectedOrganizationSlug,
    sourceId,
    syncTaskId,
  );
  const syncSnapshot: GitDeployStatusSnapshot | GitSyncTarget = readGitSyncSnapshot(syncResponse.task);
  if ('state' in syncSnapshot) {
    return syncSnapshot;
  }

  return await readGitDeploymentSnapshot(selectedOrganizationSlug, environmentName, syncSnapshot);
}

async function readGitDeploymentSnapshot(
  selectedOrganizationSlug: string,
  environmentName: string | undefined,
  target: GitSyncTarget,
): Promise<GitDeployStatusSnapshot> {
  try {
    return readDeploymentStatusSnapshot(
      await readBrowserDeploymentStatus(selectedOrganizationSlug, {
        environmentName,
        projectName: target.projectName,
      }),
    );
  } catch {
    return createGitDeploySnapshot('active', 'pending', 'Deployment is queued.');
  }
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
