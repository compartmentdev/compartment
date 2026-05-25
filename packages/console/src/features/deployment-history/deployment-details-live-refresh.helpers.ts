import type { DeploymentRuntimeStatus } from '@compartment/contracts/browser';
import type { BrowserDeploymentDetailsPageResult } from '../../services/browser-deployment-history.service.types';
import {
  buildBrowserOrganizationProjectDeploymentDetailsPathname,
  buildBrowserProjectDeploymentDetailsPathname,
} from '../../browser-public-paths';
import { redirectBrowserWindow } from '../../lib/browser-redirect';
import { refreshDeploymentDetailsPageDataForUrl } from './deployment-details-loader';

type DeploymentDetailsDataSetter = (data: BrowserDeploymentDetailsPageResult) => void;
type RefreshCancellationReader = () => boolean;
type RefreshHrefReader = () => string;
type RefreshRedirectHandler = (error: Error) => boolean;
type DeploymentDetailsRefresher = (
  data: BrowserDeploymentDetailsPageResult,
) => Promise<BrowserDeploymentDetailsPageResult>;

interface DeploymentDetailsRefreshStateInput {
  data: BrowserDeploymentDetailsPageResult;
  isCancelled: RefreshCancellationReader;
  readLocationHref: RefreshHrefReader;
  refreshPageData?: DeploymentDetailsRefresher | undefined;
  redirect?: RefreshRedirectHandler | undefined;
  setData: DeploymentDetailsDataSetter;
}

export function shouldRefreshDeploymentDetailsPage(data: BrowserDeploymentDetailsPageResult): boolean {
  return isInFlightDeploymentStatus(data.deployment.status);
}

export async function refreshDeploymentDetailsPageState(input: DeploymentDetailsRefreshStateInput): Promise<void> {
  if (input.isCancelled() || !matchesDeploymentDetailsLocation(input.data, input.readLocationHref())) {
    return;
  }

  try {
    const refreshedData: BrowserDeploymentDetailsPageResult = await (
      input.refreshPageData ?? refreshDeploymentDetailsPageDataForUrl
    )(input.data);
    if (input.isCancelled() || !matchesDeploymentDetailsLocation(input.data, input.readLocationHref())) {
      return;
    }

    input.setData(refreshedData);
  } catch (error) {
    if (input.isCancelled() || !matchesDeploymentDetailsLocation(input.data, input.readLocationHref())) {
      return;
    }
    if (error instanceof Error && (input.redirect ?? redirectBrowserWindow)(error)) {
      return;
    }

    // Keep the current details view and try again on the next interval.
  }
}

function isInFlightDeploymentStatus(status: DeploymentRuntimeStatus): boolean {
  return status === 'queued' || status === 'running';
}

function matchesDeploymentDetailsLocation(data: BrowserDeploymentDetailsPageResult, href: string): boolean {
  const url: URL = new URL(href);

  return url.pathname === buildDeploymentDetailsLocationPathname(data);
}

function buildDeploymentDetailsLocationPathname(data: BrowserDeploymentDetailsPageResult): string {
  if (data.selectedOrganizationSlug === null) {
    return buildBrowserProjectDeploymentDetailsPathname(data.projectName, data.deploymentRunId);
  }

  return buildBrowserOrganizationProjectDeploymentDetailsPathname(
    data.selectedOrganizationSlug,
    data.projectName,
    data.deploymentRunId,
  );
}
