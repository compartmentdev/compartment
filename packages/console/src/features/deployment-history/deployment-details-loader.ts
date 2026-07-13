import {
  deploymentRunLogsResponseSchema,
  deploymentMetricsSnapshotSchema,
  type DeploymentMetricsSnapshot,
  type DeploymentRunLogsResponse,
} from '@compartment/contracts/browser';
import { redirect, type LoaderFunctionArgs } from 'react-router';
import { BrowserApiError, requestBrowserApi } from '../../lib/browser-api';
import { BrowserRedirect } from '../../lib/browser-redirect';
import type { BrowserDeploymentDetailsPageResult } from '../../services/browser-deployment-history.service.types';
import type { BrowserConsoleContext } from '../console/console-data';
import {
  buildDeploymentDetailsPageResult,
  buildDeploymentDetailsRefreshContext,
  buildDeploymentDetailsUnavailableHref,
  buildDeploymentMetricsStatusPath,
  buildDeploymentRunLogsPath,
  buildHistoryHrefInput,
} from './deployment-details-loader.helpers';
import {
  loadDeploymentHistoryConsoleContext,
  readDeploymentHistoryLocationQuery,
  readRequiredRouteParam,
  throwDeploymentHistoryApiRedirect,
  type DeploymentHistoryLocationQuery,
} from './deployment-history-loader.shared';
import { buildDeploymentHistoryHref } from './deployment-history-query';

interface DeploymentDetailsLoaderContext {
  consoleContext: BrowserConsoleContext;
  deploymentRunId: string;
  projectName: string;
  query: DeploymentHistoryLocationQuery;
}

export async function loadDeploymentDetailsPageData({
  params,
  request,
}: LoaderFunctionArgs): Promise<BrowserDeploymentDetailsPageResult> {
  const url: URL = new URL(request.url);
  const projectName: string = readRequiredRouteParam(params.projectName, 'projectName');
  const deploymentRunId: string = readRequiredRouteParam(params.deploymentRunId, 'deploymentRunId');

  try {
    return await loadDeploymentDetailsPageDataForUrl(projectName, deploymentRunId, url);
  } catch (error) {
    if (error instanceof BrowserRedirect) {
      return redirect(error.to) as never;
    }

    throw error;
  }
}

export async function refreshDeploymentDetailsPageDataForUrl(
  currentData: BrowserDeploymentDetailsPageResult,
): Promise<BrowserDeploymentDetailsPageResult> {
  return await loadDeploymentDetailsPageResult({
    consoleContext: buildDeploymentDetailsRefreshContext(currentData),
    deploymentRunId: currentData.deploymentRunId,
    projectName: currentData.projectName,
    query: {
      environmentName: currentData.environmentName,
    },
  });
}

async function loadDeploymentDetailsPageDataForUrl(
  projectName: string,
  deploymentRunId: string,
  url: URL,
): Promise<BrowserDeploymentDetailsPageResult> {
  const query: DeploymentHistoryLocationQuery = readDeploymentHistoryLocationQuery(url.searchParams);
  const consoleContext: BrowserConsoleContext = await loadDeploymentHistoryConsoleContext(url);
  return await loadDeploymentDetailsPageResult({
    consoleContext,
    deploymentRunId,
    projectName,
    query,
  });
}

async function loadDeploymentDetailsPageResult(
  context: DeploymentDetailsLoaderContext,
): Promise<BrowserDeploymentDetailsPageResult> {
  const selectedOrganizationSlug: string = readSelectedOrganizationSlug(context);
  const runLogs: DeploymentRunLogsResponse | null = await readDeploymentRunLogsResponse(
    context,
    selectedOrganizationSlug,
  );
  if (runLogs === null) {
    throwDeploymentDetailsUnavailableRedirect(context, selectedOrganizationSlug);
  }
  return buildDeploymentDetailsPageResult({
    consoleContext: context.consoleContext,
    deploymentRunId: context.deploymentRunId,
    projectName: context.projectName,
    query: context.query,
    runLogs,
    metrics: await readDeploymentMetricsStatus(context, runLogs, selectedOrganizationSlug),
    selectedOrganizationSlug,
  });
}

async function readDeploymentMetricsStatus(
  context: DeploymentDetailsLoaderContext,
  runLogs: DeploymentRunLogsResponse,
  selectedOrganizationSlug: string,
): Promise<DeploymentMetricsSnapshot> {
  try {
    return await requestBrowserApi<DeploymentMetricsSnapshot>(
      buildDeploymentMetricsStatusPath(context.projectName, runLogs.environment.name),
      deploymentMetricsSnapshotSchema,
      { currentOrganization: selectedOrganizationSlug },
    );
  } catch {
    return { observedAt: null, pods: [], state: 'unavailable' };
  }
}

function throwDeploymentDetailsUnavailableRedirect(
  context: DeploymentDetailsLoaderContext,
  selectedOrganizationSlug: string,
): never {
  throw new BrowserRedirect(
    buildDeploymentDetailsUnavailableHref(context.projectName, context.query, selectedOrganizationSlug),
  );
}

function readSelectedOrganizationSlug(context: DeploymentDetailsLoaderContext): string {
  const selectedOrganizationSlug: string | null = context.consoleContext.selectedOrganizationSlug;
  if (selectedOrganizationSlug === null) {
    throw new BrowserRedirect(
      buildDeploymentHistoryHref(
        buildHistoryHrefInput(context.projectName, context.query, readRequestedOrganizationSlug(context)),
      ),
    );
  }

  return selectedOrganizationSlug;
}

function readRequestedOrganizationSlug(context: DeploymentDetailsLoaderContext): string | null {
  return context.consoleContext.organizationContext.kind === 'organization_unavailable'
    ? context.consoleContext.organizationContext.requestedOrganizationSlug
    : null;
}

async function readDeploymentRunLogsResponse(
  context: DeploymentDetailsLoaderContext,
  currentOrganization: string,
): Promise<DeploymentRunLogsResponse | null> {
  try {
    return await requestBrowserApi<DeploymentRunLogsResponse>(
      buildDeploymentRunLogsPath(context.projectName, context.deploymentRunId),
      deploymentRunLogsResponseSchema,
      {
        currentOrganization,
      },
    );
  } catch (error) {
    if (error instanceof BrowserApiError && error.status === 404) {
      return null;
    }
    if (error instanceof Error) {
      throwDeploymentHistoryApiRedirect(error);
    }

    throw error;
  }
}
