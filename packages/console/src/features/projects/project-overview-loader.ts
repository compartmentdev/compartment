import {
  projectOverviewResponseSchema,
  type ProjectEnvironmentOverview,
  type ProjectOverviewResponse,
  type ProjectScopedOperationalStatus,
  type ProjectServiceOverview,
} from '@compartment/contracts/browser';
import { redirect, type LoaderFunctionArgs } from 'react-router';
import type {
  BrowserProjectOverviewPageResult,
  BrowserProjectOverviewService,
  BrowserProjectOverviewServiceStatus,
} from '../../services/browser-project-overview.service.types';
import { buildProjectOverviewApiPath } from '../../routes/projects/projects-api-paths';
import { requestBrowserApi } from '../../lib/browser-api';
import { BrowserRedirect, readBrowserApiRedirect } from '../../lib/browser-redirect';
import {
  loadBrowserConsoleContext,
  loadBrowserProjectCount,
  readBrowserErrorMessage,
  type BrowserConsoleContext,
} from '../console/console-data';
import { readRequiredRouteParam } from '../deployment-history/deployment-history-loader.shared';
import {
  buildProjectOverviewConsoleFields,
  buildProjectOverviewDisplayFields,
  buildProjectOverviewSelectionFields,
  readProjectOverviewQueryEnvironmentName,
  type ProjectOverviewConsoleFields,
  type ProjectOverviewDisplayFields,
  type ProjectOverviewPageSharedFields,
  type ProjectOverviewSelectionFields,
} from './project-overview-loader.helpers';

interface ProjectOverviewLoaderQuery {
  errorMessage?: string | undefined;
  environmentName: string | null;
}
export async function loadProjectOverviewPageData({
  params,
  request,
}: LoaderFunctionArgs): Promise<BrowserProjectOverviewPageResult> {
  const url: URL = new URL(request.url);
  const projectName: string = readRequiredRouteParam(params.projectName, 'projectName');
  try {
    return await loadProjectOverviewPageDataForUrl(projectName, url);
  } catch (error) {
    if (error instanceof BrowserRedirect) {
      return redirect(error.to) as never;
    }
    if (error instanceof Error) {
      const apiRedirect: BrowserRedirect | null = readBrowserApiRedirect(error);
      if (apiRedirect !== null) {
        return redirect(apiRedirect.to) as never;
      }
    }

    throw error;
  }
}

async function loadProjectOverviewPageDataForUrl(
  projectName: string,
  url: URL,
): Promise<BrowserProjectOverviewPageResult> {
  const query: ProjectOverviewLoaderQuery = readProjectOverviewLoaderQuery(url.searchParams);
  const consoleContext: BrowserConsoleContext = await loadBrowserConsoleContext(
    url,
    {},
    {
      allowLegacyOrganizationQuery: false,
    },
  );

  if (consoleContext.selectedOrganizationSlug === null) {
    return buildEmptyProjectOverviewPageResult(consoleContext, projectName, query);
  }

  const [projectCount, response]: [number, ProjectOverviewResponse] = await Promise.all([
    loadBrowserProjectCount(consoleContext.selectedOrganizationSlug),
    fetchProjectOverviewResponse(projectName, consoleContext.selectedOrganizationSlug),
  ]);
  return buildProjectOverviewPageResult(consoleContext, projectCount, projectName, query, response);
}

function buildEmptyProjectOverviewPageResult(
  consoleContext: BrowserConsoleContext,
  projectName: string,
  query: ProjectOverviewLoaderQuery,
): BrowserProjectOverviewPageResult {
  return {
    canReadDeployments: false,
    currentOrganizationPermissions: consoleContext.currentOrganizationPermissions,
    errorMessage: query.errorMessage,
    environments: [],
    organizationContext: consoleContext.organizationContext,
    organizations: consoleContext.organizations,
    principalEmail: consoleContext.principalEmail,
    projectCount: 0,
    project: null,
    projectName,
    selectedEnvironmentName: null,
    selectedOrganizationSlug: null,
    services: [],
    showOrganizationSelector: consoleContext.showOrganizationSelector,
  };
}

function buildProjectOverviewPageResult(
  consoleContext: BrowserConsoleContext,
  projectCount: number,
  projectName: string,
  query: ProjectOverviewLoaderQuery,
  response: ProjectOverviewResponse,
): BrowserProjectOverviewPageResult {
  const sharedFields: ProjectOverviewPageSharedFields = buildProjectOverviewSharedFields(
    consoleContext,
    projectCount,
    projectName,
    query,
    response,
  );

  return {
    ...sharedFields,
    errorMessage: query.errorMessage,
    services: buildProjectOverviewServices(response.environments, sharedFields.selectedEnvironmentName),
  };
}

function buildProjectOverviewSharedFields(
  consoleContext: BrowserConsoleContext,
  projectCount: number,
  projectName: string,
  query: ProjectOverviewLoaderQuery,
  response: ProjectOverviewResponse,
): ProjectOverviewPageSharedFields {
  const consoleFields: ProjectOverviewConsoleFields = buildProjectOverviewConsoleFields(consoleContext, projectCount);
  const displayFields: ProjectOverviewDisplayFields = buildProjectOverviewDisplayFields(response);
  const selectionFields: ProjectOverviewSelectionFields = buildProjectOverviewSelectionFields(
    consoleContext,
    query.environmentName,
    displayFields.environments,
  );

  return {
    ...consoleFields,
    ...displayFields,
    projectName,
    ...selectionFields,
  };
}

function buildProjectOverviewServices(
  environments: readonly ProjectEnvironmentOverview[],
  selectedEnvironmentName: string | null,
): BrowserProjectOverviewService[] {
  if (selectedEnvironmentName === null) {
    return environments.flatMap((environment: ProjectEnvironmentOverview): BrowserProjectOverviewService[] =>
      buildProjectOverviewEnvironmentServices(environment),
    );
  }

  const environment: ProjectEnvironmentOverview | undefined = readSelectedProjectOverviewEnvironment(
    environments,
    selectedEnvironmentName,
  );
  if (environment === undefined) {
    return [];
  }

  return buildProjectOverviewEnvironmentServices(environment);
}

function readSelectedProjectOverviewEnvironment(
  environments: readonly ProjectEnvironmentOverview[],
  selectedEnvironmentName: string | null,
): ProjectEnvironmentOverview | undefined {
  return environments.find(
    (candidate: ProjectEnvironmentOverview): boolean => candidate.name === selectedEnvironmentName,
  );
}

function buildProjectOverviewEnvironmentServices(
  environment: ProjectEnvironmentOverview,
): BrowserProjectOverviewService[] {
  return environment.services.map(
    (service: ProjectServiceOverview): BrowserProjectOverviewService =>
      buildProjectOverviewService(environment.name, service),
  );
}

function buildProjectOverviewService(
  environmentName: string,
  service: ProjectServiceOverview,
): BrowserProjectOverviewService {
  return {
    environmentName,
    kind: service.kind,
    lastDeploymentCreatedAt: service.lastDeploymentCreatedAt,
    name: service.name,
    routeUrl: service.routeUrl,
    status: toBrowserProjectOverviewServiceStatus(service.status),
  };
}

function toBrowserProjectOverviewServiceStatus(
  status: ProjectScopedOperationalStatus,
): BrowserProjectOverviewServiceStatus {
  switch (status) {
    case 'healthy':
    case 'needs_attention':
    case 'not_deployed':
    case 'stopped':
    case 'updating':
      return status;
    default:
      throw new Error('Unexpected project overview service status.');
  }
}

async function fetchProjectOverviewResponse(
  projectName: string,
  currentOrganization: string,
): Promise<ProjectOverviewResponse> {
  return await requestBrowserApi<ProjectOverviewResponse>(
    buildProjectOverviewApiPath(projectName),
    projectOverviewResponseSchema,
    {
      currentOrganization,
    },
  );
}

function readProjectOverviewLoaderQuery(searchParams: URLSearchParams): ProjectOverviewLoaderQuery {
  return {
    errorMessage: readBrowserErrorMessage(searchParams.get('error')),
    environmentName: readProjectOverviewQueryEnvironmentName(searchParams),
  };
}
