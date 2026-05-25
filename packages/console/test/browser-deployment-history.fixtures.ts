import {
  type DeploymentReadSummary,
  type DeploymentRunLogLine,
  type DeploymentRunLogsResponse,
  type DeploymentRunStepSummary,
  type DeploymentRunSummary,
} from '@compartment/contracts/browser';
import type {
  BrowserDeploymentDetailsPageResult,
  BrowserDeploymentHistoryPageResult,
} from '../src/services/browser-deployment-history.service.types';
import { buildDeploymentHistoryHref } from '../src/features/deployment-history/deployment-history-query';

export function createDeploymentHistoryPageResult(
  overrides?: Partial<BrowserDeploymentHistoryPageResult>,
): BrowserDeploymentHistoryPageResult {
  const result: BrowserDeploymentHistoryPageResult = {
    currentOrganizationPermissions: ['organization.user.read'],
    currentEnvironmentPermissions: ['project.read'],
    environmentName: 'production',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [
      {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
    ],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    projectName: 'billing',
    deployments: [createDeploymentReadSummary()],
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    ...overrides,
  };

  if (overrides?.currentEnvironmentPermissions === undefined) {
    result.currentEnvironmentPermissions =
      overrides?.currentOrganizationPermissions ?? result.currentEnvironmentPermissions;
  }

  return result;
}

export function createDeploymentDetailsPageResult(
  overrides?: Partial<BrowserDeploymentDetailsPageResult>,
): BrowserDeploymentDetailsPageResult {
  const runLogsResponse: DeploymentRunLogsResponse = createDeploymentRunLogsResponse();
  const deployment: DeploymentRunSummary = runLogsResponse.deployment;
  const deployments: DeploymentReadSummary[] = runLogsResponse.deployments;
  const lines: DeploymentRunLogLine[] = runLogsResponse.lines;
  const steps: DeploymentRunStepSummary[] = runLogsResponse.steps;

  const result: BrowserDeploymentDetailsPageResult = {
    backHref: buildDeploymentHistoryHref({
      environmentName: 'production',
      organizationSlug: 'acme-dev',
      projectName: 'billing',
    }),
    currentOrganizationPermissions: ['organization.user.read'],
    deployment,
    deploymentRunId: deployment.id,
    deployments,
    environmentName: 'production',
    lines,
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [
      {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
    ],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    projectName: 'billing',
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    steps,
    ...overrides,
  };

  return result;
}

export function createDeploymentReadSummary(overrides?: Partial<DeploymentReadSummary>): DeploymentReadSummary {
  const result: DeploymentReadSummary = {
    completedAt: '2026-04-21T09:02:00.000Z',
    createdAt: '2026-04-21T09:00:00.000Z',
    deploymentRunId: 'drn_123',
    failureMessage: null,
    health: 'healthy',
    id: 'dep_123',
    isActive: true,
    label: 'release 42',
    operation: {
      completedAt: '2026-04-21T09:02:00.000Z',
      createdAt: '2026-04-21T09:00:00.000Z',
      status: 'succeeded',
      type: 'deployment.create',
    },
    promotionStage: 'active',
    reusableImageState: 'available',
    rollbackAvailable: false,
    routeUrl: 'https://billing.apps.localhost',
    serviceName: 'web',
    status: 'succeeded',
    ...overrides,
  };

  return result;
}

export function createDeploymentRunLogsResponse(): DeploymentRunLogsResponse {
  return {
    deployment: {
      completedAt: '2026-04-21T09:02:00.000Z',
      createdAt: '2026-04-21T09:00:00.000Z',
      failureMessage: null,
      id: 'drn_123',
      label: 'release 42',
      status: 'succeeded',
      trigger: {
        branchName: 'main',
        commitSha: 'abc123',
        repositoryName: 'platform',
        repositoryOwner: 'example-labs',
        sourceEventId: null,
        sourceResolutionTaskId: null,
        type: 'manual',
      },
    },
    deployments: [createDeploymentReadSummary()],
    environment: {
      name: 'production',
    },
    lines: [
      {
        deploymentId: 'dep_123',
        level: 'info',
        message: 'boot complete',
        serviceName: 'web',
        stepKey: 'starting_candidate',
        stream: 'stdout',
        timestamp: '2026-04-21T09:01:30.000Z',
      },
    ],
    project: {
      name: 'billing',
    },
    steps: [
      {
        completedAt: '2026-04-21T09:00:10.000Z',
        createdAt: '2026-04-21T09:00:00.000Z',
        deploymentId: null,
        message: 'Deployment queued.',
        serviceName: null,
        status: 'succeeded',
        stepKey: 'queued',
      },
      {
        completedAt: '2026-04-21T09:01:00.000Z',
        createdAt: '2026-04-21T09:00:20.000Z',
        deploymentId: 'dep_123',
        message: 'Source prepared.',
        serviceName: 'web',
        status: 'succeeded',
        stepKey: 'preparing_source',
      },
    ],
  };
}
