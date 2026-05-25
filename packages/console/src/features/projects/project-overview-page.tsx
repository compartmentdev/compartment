import type { JSX } from 'react';
import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type { BrowserProjectOverviewPageResult } from '../../services/browser-project-overview.service.types';
import { useBrowserPageData, useBrowserSoftNavigateHandler } from '../console/console-page';
import { loadProjectOverviewPageData } from './project-overview-loader';
import { ProjectOverviewView } from './project-overview-view';

export async function loadProjectOverviewPage(args: LoaderFunctionArgs): Promise<BrowserProjectOverviewPageResult> {
  return await loadProjectOverviewPageData(args);
}

export function ProjectOverviewPage(): JSX.Element {
  const loaderData: BrowserProjectOverviewPageResult = useLoaderData();
  const [data] = useBrowserPageData(loaderData);
  const onNavigate: BrowserSoftNavigateHandler = useBrowserSoftNavigateHandler();

  return <ProjectOverviewView data={data} onNavigate={onNavigate} />;
}
