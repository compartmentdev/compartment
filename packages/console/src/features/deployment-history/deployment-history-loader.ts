import {
  deploymentListResponseSchema,
  type DeploymentListResponse,
  type PermissionKey,
} from '@compartment/contracts/browser';
import { redirect, type LoaderFunctionArgs } from 'react-router';
import { BrowserRedirect } from '../../lib/browser-redirect';
import type { BrowserDeploymentHistoryPageResult } from '../../services/browser-deployment-history.service.types';
import { loadBrowserEnvironmentPermissions, type BrowserConsoleContext } from '../console/console-data';
import { buildDeploymentListPath } from './deployment-details-loader.helpers';
import {
  buildProjectOverviewEnvironmentRequiredHref,
  fetchDeploymentHistoryApi,
  loadDeploymentHistoryConsoleContext,
  readDeploymentHistoryErrorMessage,
  readDeploymentHistoryLocationQuery,
  readRequiredRouteParam,
  type DeploymentHistoryLocationQuery,
} from './deployment-history-loader.shared';

interface DeploymentHistoryLoaderQuery extends DeploymentHistoryLocationQuery {
  errorMessage?: string | undefined;
}

interface DeploymentHistoryLoaderContext {
  consoleContext: BrowserConsoleContext;
  currentEnvironmentPermissions: PermissionKey[];
  projectName: string;
  query: DeploymentHistoryLoaderQuery;
}

const deploymentHistoryPageLimit: number = 50;

export async function loadDeploymentHistoryPageData({
  params,
  request,
}: LoaderFunctionArgs): Promise<BrowserDeploymentHistoryPageResult> {
  const url: URL = new URL(request.url);
  const projectName: string = readRequiredRouteParam(params.projectName, 'projectName');

  try {
    return await loadDeploymentHistoryPageDataForUrl(projectName, url);
  } catch (error) {
    if (error instanceof BrowserRedirect) {
      return redirect(error.to) as never;
    }

    throw error;
  }
}

async function loadDeploymentHistoryPageDataForUrl(
  projectName: string,
  url: URL,
): Promise<BrowserDeploymentHistoryPageResult> {
  const context: DeploymentHistoryLoaderContext = await buildDeploymentHistoryLoaderContext(projectName, url);

  const organizationSlug: string | null = context.consoleContext.selectedOrganizationSlug;
  if (organizationSlug === null) {
    return buildEmptyDeploymentHistoryPageResult(context);
  }

  return await loadSelectedOrganizationDeploymentHistoryPageResult(context, organizationSlug);
}

async function loadSelectedOrganizationDeploymentHistoryPageResult(
  context: DeploymentHistoryLoaderContext,
  organizationSlug: string,
): Promise<BrowserDeploymentHistoryPageResult> {
  const environmentName: string = readRequiredDeploymentHistoryEnvironmentName(
    context.projectName,
    organizationSlug,
    context.query.environmentName,
  );
  return buildDeploymentHistoryPageResult(context, await readDeploymentListResponse(context), environmentName);
}

async function buildDeploymentHistoryLoaderContext(
  projectName: string,
  url: URL,
): Promise<DeploymentHistoryLoaderContext> {
  const searchParams: URLSearchParams = url.searchParams;
  const consoleContext: BrowserConsoleContext = await loadDeploymentHistoryConsoleContext(url);
  const query: DeploymentHistoryLoaderQuery = readDeploymentHistoryLoaderQuery(searchParams);

  return {
    consoleContext,
    currentEnvironmentPermissions: await loadBrowserEnvironmentPermissions(
      consoleContext.selectedOrganizationSlug,
      query.environmentName === null
        ? null
        : {
            environmentName: query.environmentName,
            projectName,
          },
    ),
    projectName,
    query,
  };
}

async function readDeploymentListResponse(context: DeploymentHistoryLoaderContext): Promise<DeploymentListResponse> {
  const currentOrganization: string | null = context.consoleContext.selectedOrganizationSlug;
  if (currentOrganization === null) {
    throw new Error('Expected selected organization before loading deployment history.');
  }

  return await fetchDeploymentHistoryApi(
    buildDeploymentListPath(buildDeploymentListQuery(context.projectName, context.query)),
    deploymentListResponseSchema,
    currentOrganization,
  );
}

function buildDeploymentListQuery(
  projectName: string,
  query: DeploymentHistoryLoaderQuery,
): {
  environmentName: string;
  limit: number;
  projectName: string;
} {
  return {
    environmentName: requireEnvironmentName(query.environmentName),
    limit: deploymentHistoryPageLimit,
    projectName,
  };
}

function buildDeploymentHistoryPageResult(
  context: DeploymentHistoryLoaderContext,
  response: DeploymentListResponse,
  environmentName: string,
): BrowserDeploymentHistoryPageResult {
  return {
    currentEnvironmentPermissions: context.currentEnvironmentPermissions,
    currentOrganizationPermissions: context.consoleContext.currentOrganizationPermissions,
    deployments: response.deployments,
    environmentName,
    errorMessage: context.query.errorMessage,
    organizationContext: context.consoleContext.organizationContext,
    organizations: context.consoleContext.organizations,
    principalEmail: context.consoleContext.principalEmail,
    projectName: response.project.name,
    selectedOrganizationSlug: context.consoleContext.selectedOrganizationSlug,
    showOrganizationSelector: context.consoleContext.showOrganizationSelector,
  };
}

function buildEmptyDeploymentHistoryPageResult(
  context: DeploymentHistoryLoaderContext,
): BrowserDeploymentHistoryPageResult {
  return {
    currentEnvironmentPermissions: context.currentEnvironmentPermissions,
    currentOrganizationPermissions: context.consoleContext.currentOrganizationPermissions,
    deployments: [],
    environmentName: context.query.environmentName,
    errorMessage: context.query.errorMessage,
    organizationContext: context.consoleContext.organizationContext,
    organizations: context.consoleContext.organizations,
    principalEmail: context.consoleContext.principalEmail,
    projectName: context.projectName,
    selectedOrganizationSlug: null,
    showOrganizationSelector: context.consoleContext.showOrganizationSelector,
  };
}

function readDeploymentHistoryLoaderQuery(searchParams: URLSearchParams): DeploymentHistoryLoaderQuery {
  return {
    ...readDeploymentHistoryLocationQuery(searchParams),
    errorMessage: readDeploymentHistoryErrorMessage(searchParams),
  };
}

function requireEnvironmentName(environmentName: string | null): string {
  if (environmentName === null) {
    throw new Error('Expected environmentName.');
  }

  return environmentName;
}

function readRequiredDeploymentHistoryEnvironmentName(
  projectName: string,
  organizationSlug: string,
  environmentName: string | null,
): string {
  if (environmentName === null) {
    throw new BrowserRedirect(buildProjectOverviewEnvironmentRequiredHref(projectName, organizationSlug));
  }

  return environmentName;
}
