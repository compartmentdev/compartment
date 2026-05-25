import { useEffect, type JSX } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import type { BrowserProjectsPageResult } from '../../services/browser-projects.service.types';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { ProjectsView } from './projects-view';
import { useProjectsLiveRefresh } from './projects-live-refresh';
import { loadProjectsPageData, loadProjectsPageDataForUrl } from './projects-loader';
import type { ProjectAction, ProjectActionHandler } from './project-actions';
import {
  setBrowserPageError,
  useBrowserPageData,
  useBrowserSoftNavigateHandler,
  type BrowserPageStateSetter,
} from '../console/console-page';
import { readBrowserConsoleProjectCountQueryKey } from '../console/console-query';

export async function loadProjectsPage(args: LoaderFunctionArgs): Promise<BrowserProjectsPageResult> {
  return await loadProjectsPageData(args);
}

export function ProjectsPage(): JSX.Element {
  const loaderData: BrowserProjectsPageResult = useLoaderData();
  const [data, setData] = useBrowserPageData(loaderData);
  useSeedProjectsSidebarProjectCount(data);
  const onNavigate: BrowserSoftNavigateHandler = useBrowserSoftNavigateHandler();
  const onProjectAction: ProjectActionHandler = createProjectActionHandler(setData);
  useProjectsLiveRefresh(data, setData);

  return <ProjectsView data={data} onNavigate={onNavigate} onProjectAction={onProjectAction} />;
}

function createProjectActionHandler(setData: ProjectsDataStateSetter): ProjectActionHandler {
  return async (_action: ProjectAction, _projectName: string, actionError?: Error): Promise<void> => {
    if (actionError !== undefined) {
      setBrowserPageError(setData, actionError);
      return;
    }
    try {
      setData(await loadProjectsPageDataForUrl(new URL(window.location.href)));
    } catch (error) {
      setBrowserPageError(setData, error instanceof Error ? error : new Error('Project action failed.'));
    }
  };
}

type ProjectsDataStateSetter = BrowserPageStateSetter<BrowserProjectsPageResult>;

function useSeedProjectsSidebarProjectCount(data: BrowserProjectsPageResult): void {
  const queryClient: QueryClient = useQueryClient();

  useEffect((): void => {
    if (data.selectedOrganizationSlug === null) {
      return;
    }

    queryClient.setQueryData(
      readBrowserConsoleProjectCountQueryKey(data.selectedOrganizationSlug),
      readActiveProjectsCount(data),
    );
  }, [data, queryClient]);
}

function readActiveProjectsCount(data: BrowserProjectsPageResult): number {
  return data.archiveState === 'active' ? data.totalProjects : Math.max(0, data.projectCount - data.totalProjects);
}
