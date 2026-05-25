import type { PermissionKey } from '@compartment/contracts/browser';
import { readRequiredEnvironmentValue } from './console-e2e-runtime';

export interface ConsoleE2eDeploymentFixture {
  readonly attackerRouteUrl: string;
  readonly deploymentRunId: string;
  readonly projectName: string;
  readonly routeUrl: string;
  readonly serviceName: string;
}

export interface ConsoleE2eCleanupProjectFixture {
  readonly dockerNamespace: string;
  readonly projectName: string;
}

export interface ConsoleE2eAccessFixture {
  readonly groupDescription: string;
  readonly groupName: string;
  readonly roleDescription: string;
  readonly roleName: string;
  readonly rolePermissions: PermissionKey[];
  readonly userEmail: string;
}

export interface ConsoleE2eProxyRouteFixture {
  readonly proxyPath: string;
  readonly routeUrl: string;
}

export interface ConsoleE2eResourceOwnershipFixture {
  readonly otherOrganizationSlug: string;
}

export interface ConsoleE2eFixture {
  readonly cleanupProject: ConsoleE2eCleanupProjectFixture;
  readonly deployment: ConsoleE2eDeploymentFixture;
  readonly organizationSlug: string;
  readonly proxyRoute: ConsoleE2eProxyRouteFixture;
  readonly resourceOwnership: ConsoleE2eResourceOwnershipFixture;
}

export function readConsoleE2eFixture(): ConsoleE2eFixture {
  const deployment: ConsoleE2eDeploymentFixture = {
    attackerRouteUrl: readRequiredEnvironmentValue('COMPARTMENT_E2E_ATTACKER_APP_BASE_URL'),
    deploymentRunId: readRequiredEnvironmentValue('COMPARTMENT_E2E_DEPLOYMENT_RUN_ID'),
    projectName: readRequiredEnvironmentValue('COMPARTMENT_E2E_PROJECT_NAME'),
    routeUrl: readRequiredEnvironmentValue('COMPARTMENT_E2E_APP_BASE_URL'),
    serviceName: readRequiredEnvironmentValue('COMPARTMENT_E2E_SERVICE_NAME'),
  };
  const proxyRoute: ConsoleE2eProxyRouteFixture = {
    proxyPath: readRequiredEnvironmentValue('COMPARTMENT_E2E_PROXY_TARGET_PATH'),
    routeUrl: readRequiredEnvironmentValue('COMPARTMENT_E2E_PROXY_ROUTE_URL'),
  };
  const resourceOwnership: ConsoleE2eResourceOwnershipFixture = {
    otherOrganizationSlug: readRequiredEnvironmentValue('COMPARTMENT_E2E_OTHER_ORGANIZATION_SLUG'),
  };
  const cleanupProject: ConsoleE2eCleanupProjectFixture = {
    dockerNamespace: readRequiredEnvironmentValue('COMPARTMENT_E2E_DOCKER_NAMESPACE'),
    projectName: readRequiredEnvironmentValue('COMPARTMENT_E2E_CLEANUP_PROJECT_NAME'),
  };

  return {
    cleanupProject,
    deployment,
    organizationSlug: readRequiredEnvironmentValue('COMPARTMENT_E2E_ORGANIZATION_SLUG'),
    proxyRoute,
    resourceOwnership,
  };
}

export function buildConsoleE2eAccessFixture(deploymentRunId: string, attemptId: string): ConsoleE2eAccessFixture {
  const suffix: string = readConsoleE2eAccessSuffix(deploymentRunId, attemptId);

  return {
    groupDescription: `Created by console e2e ${suffix}`,
    groupName: `console-e2e-ui-group-${suffix}`,
    roleDescription: `Created by console e2e ${suffix}`,
    roleName: `console-e2e-ui-role-${suffix}`,
    rolePermissions: ['project.read', 'deployment.read'],
    userEmail: `console-e2e-ui-user-${suffix}@compartment.test`,
  };
}

function readConsoleE2eAccessSuffix(deploymentRunId: string, attemptId: string): string {
  const deploymentSuffix: string = readConsoleE2eSuffixPart(deploymentRunId).slice(0, 12);
  const attemptSuffix: string = readConsoleE2eSuffixPart(attemptId).slice(0, 8);

  return `${deploymentSuffix}-${attemptSuffix}`;
}

function readConsoleE2eSuffixPart(value: string): string {
  const suffix: string = value.replaceAll(/[^a-zA-Z0-9]/gu, '').toLowerCase();
  if (suffix === '') {
    throw new Error('Console e2e access fixture suffix values must contain at least one alphanumeric character.');
  }

  return suffix;
}
