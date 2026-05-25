import type { JSX } from 'react';
import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import type { BrowserDeploymentDetailsPageResult } from '../../services/browser-deployment-history.service.types';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { useBrowserPageData, useBrowserSoftNavigateHandler } from '../console/console-page';
import { loadDeploymentDetailsPageData } from './deployment-details-loader';
import { useDeploymentDetailsLiveRefresh } from './deployment-details-live-refresh';
import { DeploymentDetailsView } from './deployment-details-view';

export async function loadDeploymentDetailsPage(args: LoaderFunctionArgs): Promise<BrowserDeploymentDetailsPageResult> {
  return await loadDeploymentDetailsPageData(args);
}

export function DeploymentDetailsPage(): JSX.Element {
  const loaderData: BrowserDeploymentDetailsPageResult = useLoaderData();
  const [data, setData] = useBrowserPageData(loaderData);
  const onNavigate: BrowserSoftNavigateHandler = useBrowserSoftNavigateHandler();
  useDeploymentDetailsLiveRefresh(data, setData);

  return <DeploymentDetailsView data={data} onNavigate={onNavigate} />;
}
