import {
  compartmentBrowserAssetsPathname,
  compartmentBrowserLoginSsoPathname,
  compartmentBrowserOnboardingPathname,
  compartmentBrowserOrganizationsPathname,
  compartmentBrowserProjectCreatePathname,
  compartmentBrowserProjectsPathname,
} from '../browser';

export const compartmentConsoleLoginSsoCallbackPathname: string = `${compartmentBrowserLoginSsoPathname}/callback`;
const compartmentConsoleOrganizationPathnameTemplate: string = `${compartmentBrowserOrganizationsPathname}/:organizationSlug`;
export const compartmentConsoleOrganizationAuditPathnameTemplate: string = `${compartmentConsoleOrganizationPathnameTemplate}/audit`;
export const compartmentConsoleOrganizationGroupsPathnameTemplate: string = `${compartmentConsoleOrganizationPathnameTemplate}/groups`;
export const compartmentConsoleOrganizationOnboardingPathnameTemplate: string = `${compartmentConsoleOrganizationPathnameTemplate}${compartmentBrowserOnboardingPathname}`;
export const compartmentConsoleOrganizationProjectCreatePathnameTemplate: string = `${compartmentConsoleOrganizationPathnameTemplate}${compartmentBrowserProjectCreatePathname}`;
export const compartmentConsoleOrganizationProjectsPathnameTemplate: string = `${compartmentConsoleOrganizationPathnameTemplate}${compartmentBrowserProjectsPathname}`;
export const compartmentConsoleOrganizationRolesPathnameTemplate: string = `${compartmentConsoleOrganizationPathnameTemplate}/roles`;
export const compartmentConsoleOrganizationUsersPathnameTemplate: string = `${compartmentConsoleOrganizationPathnameTemplate}/users`;
export const compartmentConsoleOrganizationProjectOverviewPathnameTemplate: string = `${compartmentConsoleOrganizationProjectsPathnameTemplate}/:projectName`;
export const compartmentConsoleOrganizationProjectDeploymentsPathnameTemplate: string = `${compartmentConsoleOrganizationProjectsPathnameTemplate}/:projectName/deployments`;
export const compartmentConsoleOrganizationProjectDeploymentDetailsPathnameTemplate: string = `${compartmentConsoleOrganizationProjectDeploymentsPathnameTemplate}/:deploymentRunId`;

export function buildCompartmentConsoleAssetPathname(assetFileName: string): string {
  return `${compartmentBrowserAssetsPathname}/${normalizeCompartmentConsoleAssetPath(assetFileName)}`;
}

export function buildCompartmentConsoleOrganizationOnboardingPathname(organizationSlug: string): string {
  return buildCompartmentConsoleOrganizationScopedPathname(organizationSlug, compartmentBrowserOnboardingPathname);
}

export function buildCompartmentConsoleOrganizationProjectDeploymentDetailsPathname(
  organizationSlug: string,
  projectName: string,
  deploymentRunId: string,
): string {
  return `${buildCompartmentConsoleOrganizationProjectDeploymentsPathname(
    organizationSlug,
    projectName,
  )}/${encodeURIComponent(deploymentRunId)}`;
}

function buildCompartmentConsoleOrganizationProjectDeploymentsPathname(
  organizationSlug: string,
  projectName: string,
): string {
  return `${buildCompartmentConsoleOrganizationProjectOverviewPathname(organizationSlug, projectName)}/deployments`;
}

function buildCompartmentConsoleOrganizationProjectOverviewPathname(
  organizationSlug: string,
  projectName: string,
): string {
  return `${buildCompartmentConsoleOrganizationProjectsPathname(organizationSlug)}/${encodeURIComponent(projectName)}`;
}

export function buildCompartmentConsoleOrganizationProjectsPathname(organizationSlug: string): string {
  return buildCompartmentConsoleOrganizationScopedPathname(organizationSlug, compartmentBrowserProjectsPathname);
}

export function buildCompartmentConsoleOrganizationScopedPathname(organizationSlug: string, pathname: string): string {
  return `${buildCompartmentConsoleOrganizationPathname(organizationSlug)}${pathname}`;
}

function buildCompartmentConsoleOrganizationPathname(organizationSlug: string): string {
  return `${compartmentBrowserOrganizationsPathname}/${encodeURIComponent(organizationSlug)}`;
}

export function buildCompartmentConsoleProjectDeploymentDetailsPathname(
  projectName: string,
  deploymentRunId: string,
): string {
  return `${buildCompartmentConsoleProjectDeploymentsPathname(projectName)}/${encodeURIComponent(deploymentRunId)}`;
}

export function buildCompartmentConsoleProjectDeploymentsPathname(projectName: string): string {
  return `${buildCompartmentConsoleProjectOverviewPathname(projectName)}/deployments`;
}

export function buildCompartmentConsoleProjectOverviewPathname(projectName: string): string {
  return `${compartmentBrowserProjectsPathname}/${encodeURIComponent(projectName)}`;
}

function normalizeCompartmentConsoleAssetPath(assetFileName: string): string {
  const normalizedAssetFileName: string = assetFileName.replaceAll('\\', '/').replace(/^\/+/u, '');
  const segments: string[] = normalizedAssetFileName
    .split('/')
    .filter((segment: string): boolean => segment.length > 0);

  if (segments.length === 0) {
    throw new Error('Expected a control-plane asset file name.');
  }

  return segments.map(encodeCompartmentConsoleAssetPathSegment).join('/');
}

function encodeCompartmentConsoleAssetPathSegment(segment: string): string {
  if (segment === '.' || segment === '..') {
    throw new Error(`Invalid control-plane asset path segment: ${segment}`);
  }

  return encodeURIComponent(segment);
}
