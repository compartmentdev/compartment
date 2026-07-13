import type {
  DeploymentReadSummary,
  DeploymentMetricsSnapshot,
  DeploymentRunLogLine,
  DeploymentRunStepSummary,
  DeploymentRunSummary,
  PermissionKey,
} from '@compartment/contracts';
import type { BrowserConsoleOrganizationContext } from './browser-organization-context.service.types';
import type { BrowserOrganizationOption } from './browser-organization.service.types';

export interface BrowserDeploymentHistoryPageResult {
  currentEnvironmentPermissions: PermissionKey[];
  currentOrganizationPermissions: PermissionKey[];
  deployments: DeploymentReadSummary[];
  environmentName: string | null;
  errorMessage?: string | undefined;
  organizationContext: BrowserConsoleOrganizationContext;
  organizations: BrowserOrganizationOption[];
  principalEmail: string;
  projectCount?: number | undefined;
  projectName: string;
  selectedOrganizationSlug: string | null;
  showOrganizationSelector: boolean;
}

export interface BrowserDeploymentDetailsPageResult {
  backHref: string;
  currentOrganizationPermissions: PermissionKey[];
  deployment: DeploymentRunSummary;
  deploymentRunId: string;
  deployments: DeploymentReadSummary[];
  errorMessage?: string | undefined;
  environmentName: string;
  lines: DeploymentRunLogLine[];
  metrics: DeploymentMetricsSnapshot;
  organizationContext: BrowserConsoleOrganizationContext;
  organizations: BrowserOrganizationOption[];
  principalEmail: string;
  projectCount?: number | undefined;
  projectName: string;
  selectedOrganizationSlug: string | null;
  showOrganizationSelector: boolean;
  steps: DeploymentRunStepSummary[];
}
