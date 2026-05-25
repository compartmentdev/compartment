import type {
  PermissionKey,
  ProjectEnvironmentOverview,
  ProjectOverviewResponse,
  ProjectOverviewSummary,
} from '@compartment/contracts/browser';
import type { BrowserConsoleContext } from '../console/console-data';
import type { BrowserConsoleOrganizationContext } from '../../services/browser-organization-context.service.types';
import type { BrowserOrganizationOption } from '../../services/browser-organization.service.types';
import type { BrowserProjectOverviewEnvironment } from '../../services/browser-project-overview.service.types';
import type { BrowserProjectSummary } from '../../services/browser-projects.service.types';
import { toBrowserProjectOpenTargets } from './project-open-targets';

export interface ProjectOverviewPageSharedFields {
  canReadDeployments: boolean;
  currentOrganizationPermissions: PermissionKey[];
  environments: BrowserProjectOverviewEnvironment[];
  organizationContext: BrowserConsoleOrganizationContext;
  organizations: BrowserOrganizationOption[];
  principalEmail: string;
  projectCount: number;
  project: BrowserProjectSummary | null;
  projectName: string;
  selectedEnvironmentName: string | null;
  selectedOrganizationSlug: string | null;
  showOrganizationSelector: boolean;
}

export type ProjectOverviewConsoleFields = Pick<
  ProjectOverviewPageSharedFields,
  'currentOrganizationPermissions' | 'organizationContext' | 'organizations' | 'principalEmail' | 'projectCount'
>;

export interface ProjectOverviewDisplayFields {
  canReadDeployments: boolean;
  environments: BrowserProjectOverviewEnvironment[];
  project: BrowserProjectSummary;
}

export type ProjectOverviewSelectionFields = Pick<
  ProjectOverviewPageSharedFields,
  'selectedEnvironmentName' | 'selectedOrganizationSlug' | 'showOrganizationSelector'
>;

export function readProjectOverviewQueryEnvironmentName(searchParams: URLSearchParams): string | null {
  const value: string | null = searchParams.get('environmentName');
  if (value === null) {
    return null;
  }

  const normalizedValue: string = value.trim();
  return normalizedValue === '' ? null : normalizedValue;
}

export function buildProjectOverviewConsoleFields(
  consoleContext: BrowserConsoleContext,
  projectCount: number,
): ProjectOverviewConsoleFields {
  return {
    currentOrganizationPermissions: consoleContext.currentOrganizationPermissions,
    organizationContext: consoleContext.organizationContext,
    organizations: consoleContext.organizations,
    principalEmail: consoleContext.principalEmail,
    projectCount,
  };
}

export function buildProjectOverviewDisplayFields(response: ProjectOverviewResponse): ProjectOverviewDisplayFields {
  return {
    canReadDeployments: response.project.canReadDeployments,
    environments: buildBrowserProjectOverviewEnvironments(response.environments),
    project: toBrowserProjectSummary(response.project),
  };
}

export function buildProjectOverviewSelectionFields(
  consoleContext: BrowserConsoleContext,
  requestedEnvironmentName: string | null,
  environments: readonly BrowserProjectOverviewEnvironment[],
  project: BrowserProjectSummary,
): ProjectOverviewSelectionFields {
  return {
    selectedEnvironmentName: resolveSelectedEnvironmentName(
      requestedEnvironmentName,
      environments,
      project.environmentName,
    ),
    selectedOrganizationSlug: consoleContext.selectedOrganizationSlug,
    showOrganizationSelector: consoleContext.showOrganizationSelector,
  };
}

export function toBrowserProjectSummary(project: ProjectOverviewSummary): BrowserProjectSummary {
  return {
    canManageArchive: project.canManageArchive,
    canManageLifecycle: project.canManageLifecycle,
    environmentName: project.environmentName,
    id: project.id,
    lastDeploymentCreatedAt: project.lastDeploymentCreatedAt,
    lifecycleAction: project.lifecycleAction,
    lifecycleDisabledReason: project.lifecycleDisabledReason,
    lifecycleState: project.lifecycleState,
    name: project.name,
    openTargets: toBrowserProjectOpenTargets(project.openTargets),
    routeUrl: project.routeUrl,
    serviceCount: project.serviceCount,
    status: project.status,
    updatedAt: project.updatedAt,
  };
}

function buildBrowserProjectOverviewEnvironments(
  environments: readonly ProjectEnvironmentOverview[],
): BrowserProjectOverviewEnvironment[] {
  return environments.map(
    (environment: ProjectEnvironmentOverview): BrowserProjectOverviewEnvironment => ({
      name: environment.name,
      status: environment.status,
    }),
  );
}

function resolveSelectedEnvironmentName(
  requestedEnvironmentName: string | null,
  environments: readonly BrowserProjectOverviewEnvironment[],
  fallbackEnvironmentName: string,
): string | null {
  if (
    requestedEnvironmentName !== null &&
    environments.some(
      (environment: BrowserProjectOverviewEnvironment): boolean => environment.name === requestedEnvironmentName,
    )
  ) {
    return requestedEnvironmentName;
  }

  if (
    environments.some(
      (environment: BrowserProjectOverviewEnvironment): boolean => environment.name === fallbackEnvironmentName,
    )
  ) {
    return fallbackEnvironmentName;
  }

  return environments[0]?.name ?? null;
}
