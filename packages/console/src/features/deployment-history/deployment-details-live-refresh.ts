import { useEffect } from 'react';
import type { BrowserDeploymentDetailsPageResult } from '../../services/browser-deployment-history.service.types';
import { startBrowserLiveRefresh } from '../../lib/browser-live-refresh';
import {
  refreshDeploymentDetailsPageState,
  shouldRefreshDeploymentDetailsPage,
} from './deployment-details-live-refresh.helpers';

type DeploymentDetailsDataSetter = (data: BrowserDeploymentDetailsPageResult) => void;

const deploymentDetailsRefreshIntervalMs: number = 3_000;

export function useDeploymentDetailsLiveRefresh(
  data: BrowserDeploymentDetailsPageResult,
  setData: DeploymentDetailsDataSetter,
): void {
  useEffect((): (() => void) | undefined => {
    return shouldRefreshDeploymentDetailsPage(data) ? startDeploymentDetailsRefresh(data, setData) : undefined;
  }, [data, setData]);
}

function startDeploymentDetailsRefresh(
  data: BrowserDeploymentDetailsPageResult,
  setData: DeploymentDetailsDataSetter,
): () => void {
  return startBrowserLiveRefresh(
    async (isCancelled: () => boolean): Promise<void> => await refreshDeploymentDetails(data, setData, isCancelled),
    deploymentDetailsRefreshIntervalMs,
  );
}

async function refreshDeploymentDetails(
  data: BrowserDeploymentDetailsPageResult,
  setData: DeploymentDetailsDataSetter,
  isCancelled: () => boolean,
): Promise<void> {
  await refreshDeploymentDetailsPageState({
    data,
    isCancelled,
    readLocationHref: (): string => window.location.href,
    setData,
  });
}
