import { useEffect } from 'react';
import type { BrowserProjectsPageResult } from '../../services/browser-projects.service.types';
import { startBrowserLiveRefresh } from '../../lib/browser-live-refresh';
import { redirectBrowserWindow } from '../../lib/browser-redirect';
import { shouldRefreshProjectsPage } from './projects-live-refresh.helpers';
import { refreshProjectStatuses } from './projects-status-refresh';

type ProjectsDataSetter = (data: BrowserProjectsPageResult) => void;
type RefreshCancellationReader = () => boolean;

const projectsRefreshIntervalMs: number = 3000;

export function useProjectsLiveRefresh(data: BrowserProjectsPageResult, setData: ProjectsDataSetter): void {
  useEffect((): (() => void) | undefined => {
    return shouldRefreshProjectsPage(data) ? startProjectsRefresh(data, setData) : undefined;
  }, [data, setData]);
}

function startProjectsRefresh(data: BrowserProjectsPageResult, setData: ProjectsDataSetter): () => void {
  return startBrowserLiveRefresh(
    async (isCancelled: RefreshCancellationReader): Promise<void> => await refreshProjects(data, setData, isCancelled),
    projectsRefreshIntervalMs,
  );
}

async function refreshProjects(
  data: BrowserProjectsPageResult,
  setData: ProjectsDataSetter,
  isCancelled: RefreshCancellationReader,
): Promise<void> {
  try {
    await refreshProjectsOnce(data, setData, isCancelled);
  } catch (error) {
    if (error instanceof Error && redirectBrowserWindow(error)) {
      return;
    }
    // Keep the current table state and try again on the next interval.
  }
}

async function refreshProjectsOnce(
  data: BrowserProjectsPageResult,
  setData: ProjectsDataSetter,
  isCancelled: RefreshCancellationReader,
): Promise<void> {
  const href: string = window.location.href;
  const refreshedData: BrowserProjectsPageResult = await refreshProjectStatuses(data);
  if (isCancelled() || window.location.href !== href) {
    return;
  }

  setData(refreshedData);
}
