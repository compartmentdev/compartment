import type { JSX } from 'react';
import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type { BrowserDeploymentHistoryPageResult } from '../../services/browser-deployment-history.service.types';
import { useBrowserPageData, useBrowserSoftNavigateHandler } from '../console/console-page';
import { loadDeploymentHistoryPageData } from './deployment-history-loader';
import { DeploymentHistoryView } from './deployment-history-view';

export async function loadDeploymentHistoryPage(args: LoaderFunctionArgs): Promise<BrowserDeploymentHistoryPageResult> {
  return await loadDeploymentHistoryPageData(args);
}

export function DeploymentHistoryPage(): JSX.Element {
  const loaderData: BrowserDeploymentHistoryPageResult = useLoaderData();
  const [data] = useBrowserPageData(loaderData);
  const onNavigate: BrowserSoftNavigateHandler = useBrowserSoftNavigateHandler();

  return <DeploymentHistoryView data={data} onNavigate={onNavigate} />;
}
