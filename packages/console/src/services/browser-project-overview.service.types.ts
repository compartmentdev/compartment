import type { CompartmentServiceKind, PermissionKey } from '@compartment/contracts';
import type { BrowserConsoleOrganizationContext } from './browser-organization-context.service.types';
import type { BrowserOrganizationOption } from './browser-organization.service.types';
import type { BrowserProjectStatus, BrowserProjectSummary } from './browser-projects.service.types';

export type BrowserProjectOverviewServiceStatus = Exclude<BrowserProjectStatus, 'archived'>;

export interface BrowserProjectOverviewEnvironment {
  name: string;
  status: BrowserProjectOverviewServiceStatus;
}

export interface BrowserProjectOverviewService {
  environmentName: string;
  kind: CompartmentServiceKind;
  lastDeploymentCreatedAt: string | null;
  name: string;
  routeUrl: string | null;
  status: BrowserProjectOverviewServiceStatus;
}

export interface BrowserProjectOverviewPageResult {
  canReadDeployments: boolean;
  currentOrganizationPermissions: PermissionKey[];
  environments: BrowserProjectOverviewEnvironment[];
  errorMessage?: string | undefined;
  organizationContext: BrowserConsoleOrganizationContext;
  organizations: BrowserOrganizationOption[];
  principalEmail: string;
  projectCount: number;
  project: BrowserProjectSummary | null;
  projectName: string;
  selectedEnvironmentName: string | null;
  selectedOrganizationSlug: string | null;
  services: BrowserProjectOverviewService[];
  showOrganizationSelector: boolean;
}
