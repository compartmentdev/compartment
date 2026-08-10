import type { GitHubInstallationRepositoryListRequest } from './source-git-bootstrap.contract';

const compartmentAuthPathname: string = '/v1/auth';
export const compartmentAuthActivatePathname: string = `${compartmentAuthPathname}/activate`;
export const compartmentAuthActivateStatePathname: string = `${compartmentAuthPathname}/activate-state`;
export const compartmentAuthClaimPathname: string = `${compartmentAuthPathname}/claim`;
export const compartmentAuthCliExchangePathname: string = `${compartmentAuthPathname}/cli/exchange`;
export const compartmentAuthCliStartPathname: string = `${compartmentAuthPathname}/cli/start`;
export const compartmentAuthCliStatusPathname: string = `${compartmentAuthPathname}/cli/status`;
export const compartmentAuthLoginPathname: string = `${compartmentAuthPathname}/login`;
export const compartmentAuthLoginDiscoveryPathname: string = `${compartmentAuthPathname}/login-discovery`;
export const compartmentAuthLoginStatePathname: string = `${compartmentAuthPathname}/login-state`;
export const compartmentAuthLogoutPathname: string = `${compartmentAuthPathname}/logout`;
export const compartmentAuthResetPasswordPathname: string = `${compartmentAuthPathname}/reset-password`;
export const compartmentAuthResetPasswordStatePathname: string = `${compartmentAuthPathname}/reset-password-state`;
export const compartmentAuthSettingsPathname: string = `${compartmentAuthPathname}/settings`;
export const compartmentAuthSignupPathname: string = `${compartmentAuthPathname}/signup`;
export const compartmentInstallPathname: string = '/v1/install';
export const compartmentOrganizationListPathname: string = '/v1/orgs';
export const compartmentOrganizationsPathname: string = '/v1/organizations';
export const compartmentOrganizationSettingsPathname: string = `${compartmentOrganizationsPathname}/settings`;
export const compartmentAuditEventsPathname: string = '/v1/audit/events';
export const compartmentAuditEventsExportPathname: string = `${compartmentAuditEventsPathname}/export`;
export const compartmentWhoAmIPathname: string = '/v1/whoami';
export const compartmentDeploymentsPathname: string = '/v1/deployments';
export const compartmentDeploymentsRollbackPathname: string = `${compartmentDeploymentsPathname}/rollback`;
export const compartmentDeploymentsPromotePathname: string = `${compartmentDeploymentsPathname}/promote`;
export const compartmentDeploymentsStatusPathname: string = `${compartmentDeploymentsPathname}/status`;
export const compartmentDeploymentMetricsPathname: string = `${compartmentDeploymentsPathname}/metrics`;
export const compartmentDeploymentsInspectPathname: string = `${compartmentDeploymentsPathname}/inspect`;
export const compartmentDeploymentLogsPathname: string = `${compartmentDeploymentsPathname}/logs`;
export const compartmentDeploymentRunLogsPathname: string = `${compartmentDeploymentsPathname}/runs/logs`;
export const compartmentFirstDeployOnboardingPathname: string = '/v1/onboarding/first-deploy';
export const compartmentFirstDeployOnboardingSessionPathnameTemplate: string = `${compartmentFirstDeployOnboardingPathname}/:sessionId`;
export const compartmentFirstDeployOnboardingStatusPathnameTemplate: string = `${compartmentFirstDeployOnboardingSessionPathnameTemplate}/status`;
export const compartmentAssignmentsPathname: string = '/v1/assignments';
export const compartmentAssignmentScopeOptionsPathname: string = `${compartmentAssignmentsPathname}/scope-options`;
export const compartmentGroupsPathname: string = '/v1/groups';
export const compartmentGroupMembersPathnameSuffix: string = '/members';
export const compartmentCustomDomainsPathname: string = '/v1/domains';
export const compartmentProjectsApiPathname: string = '/v1/projects';
export const compartmentResourcesPathname: string = '/v1/resources';
export const compartmentResourcePathnameTemplate: string = `${compartmentResourcesPathname}/:resourceName`;
export const compartmentResourceOutputsPathnameTemplate: string = `${compartmentResourcePathnameTemplate}/outputs`;
export const compartmentResourceOutputPathnameTemplate: string = `${compartmentResourceOutputsPathnameTemplate}/:outputName`;
export const compartmentResourceBackupCollectionPathnameTemplate: string = `${compartmentResourcePathnameTemplate}/backups`;
export const compartmentResourceLogsPathnameTemplate: string = `${compartmentResourcePathnameTemplate}/logs`;
export const compartmentResourceRestorePathnameTemplate: string = `${compartmentResourcePathnameTemplate}/restore`;
export const compartmentResourceStartPathnameTemplate: string = `${compartmentResourcePathnameTemplate}/start`;
export const compartmentResourceBootstrapPathnameTemplate: string = `${compartmentResourcePathnameTemplate}/bootstrap`;
export const compartmentResourceStopPathnameTemplate: string = `${compartmentResourcePathnameTemplate}/stop`;
export const compartmentRolesPathname: string = '/v1/roles';
export const compartmentUsersApiPathname: string = '/v1/users';
export const compartmentSourcesPathname: string = '/v1/sources';
export const compartmentSsoOidcProvidersPathname: string = '/v1/sso/oidc/providers';
export const compartmentGitHubProviderBootstrapPathname: string = `${compartmentSourcesPathname}/git/providers/github/bootstrap`;
export const compartmentGitHubProviderAccountDiscoveryPathname: string = `${compartmentSourcesPathname}/git/providers/github/account-discovery`;
export const compartmentGitHubProviderAccountDiscoveryResultPathname: string = `${compartmentGitHubProviderAccountDiscoveryPathname}/result`;
export const compartmentGitHubProviderBootstrapStartPathnameTemplate: string = `${compartmentGitHubProviderBootstrapPathname}/:bootstrapStateId/start`;
export const compartmentGitHubProviderRegistrationRepositoriesPathnameTemplate: string = `${compartmentSourcesPathname}/git/providers/github/registrations/:registrationId/repositories`;
export const compartmentGitHubProviderCallbackPathname: string = `${compartmentSourcesPathname}/git/providers/github/callback`;
export const compartmentGitHubProviderSetupPathname: string = `${compartmentSourcesPathname}/git/providers/github/setup`;
export const compartmentGitSourceConnectPathname: string = `${compartmentSourcesPathname}/git/connect`;
export const compartmentGitDescriptorPlanPathname: string = `${compartmentSourcesPathname}/git/descriptor-plan`;
export const compartmentGitDescriptorPullRequestPathname: string = `${compartmentSourcesPathname}/git/descriptor-pr`;
export const compartmentGitDescriptorPullRequestStatusPathname: string = `${compartmentGitDescriptorPullRequestPathname}/status`;
export const compartmentGitSourceSettingsPathnameTemplate: string = `${compartmentSourcesPathname}/:sourceId/settings`;
export const compartmentGitSourceExcludePathnameTemplate: string = `${compartmentSourcesPathname}/:sourceId/exclude`;
export const compartmentGitSourceIncludePathnameTemplate: string = `${compartmentSourcesPathname}/:sourceId/include`;
export const compartmentGitSourceSyncPathnameTemplate: string = `${compartmentSourcesPathname}/:sourceId/sync`;
export const compartmentGitSourceSyncTaskPathnameTemplate: string = `${compartmentSourcesPathname}/:sourceId/sync/:taskId`;
export const compartmentVariablesPathname: string = '/v1/variables';
export const compartmentVariableImportPathname: string = `${compartmentVariablesPathname}/import`;
export const compartmentVariableLocalRunPathname: string = `${compartmentVariablesPathname}/local-run`;
export const compartmentVariablePathnameTemplate: string = `${compartmentVariablesPathname}/:keyName`;
export const compartmentVariableBindingPathnameTemplate: string = `${compartmentVariablesPathname}/bindings/:variableGroupName`;
export const compartmentVariableGroupsPathname: string = '/v1/variable-groups';
export const compartmentVariableGroupCapturePathname: string = `${compartmentVariableGroupsPathname}/capture`;
export const compartmentVariableGroupImportPathname: string = `${compartmentVariableGroupsPathname}/import`;
export const compartmentVariableGroupPathnameTemplate: string = `${compartmentVariableGroupsPathname}/:variableGroupName`;
export const compartmentVariableGroupUsagesPathnameTemplate: string = `${compartmentVariableGroupPathnameTemplate}/usages`;
export const compartmentVariableGroupVariablesPathname: string = `${compartmentVariableGroupsPathname}/variables`;
export const compartmentProjectApiPathnameTemplate: string = `${compartmentProjectsApiPathname}/:projectName`;
export const compartmentProjectOverviewApiPathnameTemplate: string = `${compartmentProjectApiPathnameTemplate}/overview`;
export const compartmentProjectArchiveApiPathnameTemplate: string = `${compartmentProjectApiPathnameTemplate}/archive`;
export const compartmentProjectStartApiPathnameTemplate: string = `${compartmentProjectApiPathnameTemplate}/start`;
export const compartmentProjectStopApiPathnameTemplate: string = `${compartmentProjectApiPathnameTemplate}/stop`;
export const compartmentProjectUnarchiveApiPathnameTemplate: string = `${compartmentProjectApiPathnameTemplate}/unarchive`;
export const compartmentUserApiPathnameTemplate: string = `${compartmentUsersApiPathname}/:email`;
export const compartmentUserAccessApiPathnameTemplate: string = `${compartmentUserApiPathnameTemplate}/access`;
export const compartmentUserBlockApiPathnameTemplate: string = `${compartmentUserApiPathnameTemplate}/block`;
export const compartmentUserPasswordResetApiPathnameTemplate: string = `${compartmentUserApiPathnameTemplate}/password-reset`;
export const compartmentUserUnblockApiPathnameTemplate: string = `${compartmentUserApiPathnameTemplate}/unblock`;

export function buildCompartmentGitHubProviderBootstrapStartPathname(bootstrapStateId: string): string {
  return `${compartmentGitHubProviderBootstrapPathname}/${encodeURIComponent(bootstrapStateId)}/start`;
}

export function buildCompartmentGitHubProviderRegistrationRepositoriesPathname(
  registrationId: string,
  request?: GitHubInstallationRepositoryListRequest,
): string {
  const pathname: string = `${compartmentSourcesPathname}/git/providers/github/registrations/${encodeURIComponent(registrationId)}/repositories`;
  if (request === undefined) {
    return pathname;
  }

  const searchParams: URLSearchParams = new URLSearchParams({
    providerHost: request.providerHost,
    repositoryOwner: request.repositoryOwner,
  });
  return `${pathname}?${searchParams.toString()}`;
}

export function buildCompartmentFirstDeployOnboardingStatusPathname(sessionId: string): string {
  return `${buildCompartmentFirstDeployOnboardingSessionPathname(sessionId)}/status`;
}

export function buildCompartmentFirstDeployOnboardingSessionPathname(sessionId: string): string {
  return `${compartmentFirstDeployOnboardingPathname}/${encodeURIComponent(sessionId)}`;
}

export function buildCompartmentGitSourceSyncTaskPathname(sourceId: string, taskId: string): string {
  return `${buildCompartmentGitSourceSyncPathname(sourceId)}/${encodeURIComponent(taskId)}`;
}

export function buildCompartmentGitSourceSettingsPathname(sourceId: string): string {
  return `${compartmentSourcesPathname}/${encodeURIComponent(sourceId)}/settings`;
}

export function buildCompartmentGitSourceExcludePathname(sourceId: string): string {
  return `${compartmentSourcesPathname}/${encodeURIComponent(sourceId)}/exclude`;
}

export function buildCompartmentGitSourceIncludePathname(sourceId: string): string {
  return `${compartmentSourcesPathname}/${encodeURIComponent(sourceId)}/include`;
}

export function buildCompartmentGitSourceSyncPathname(sourceId: string): string {
  return `${compartmentSourcesPathname}/${encodeURIComponent(sourceId)}/sync`;
}

export function buildCompartmentProjectArchiveApiPathname(projectName: string): string {
  return `${buildCompartmentProjectApiPathname(projectName)}/archive`;
}

export function buildCompartmentProjectOverviewApiPathname(projectName: string): string {
  return `${buildCompartmentProjectApiPathname(projectName)}/overview`;
}

export function buildCompartmentProjectStartApiPathname(projectName: string): string {
  return `${buildCompartmentProjectApiPathname(projectName)}/start`;
}

export function buildCompartmentProjectStopApiPathname(projectName: string): string {
  return `${buildCompartmentProjectApiPathname(projectName)}/stop`;
}

export function buildCompartmentProjectUnarchiveApiPathname(projectName: string): string {
  return `${buildCompartmentProjectApiPathname(projectName)}/unarchive`;
}

export function buildCompartmentProjectApiPathname(projectName: string): string {
  return `${compartmentProjectsApiPathname}/${encodeURIComponent(projectName)}`;
}

export function buildCompartmentResourceLogsPathname(resourceName: string): string {
  return `${buildCompartmentResourcePathname(resourceName)}/logs`;
}

export function buildCompartmentResourceOutputPathname(resourceName: string, outputName: string): string {
  return `${buildCompartmentResourcePathname(resourceName)}/outputs/${encodeURIComponent(outputName)}`;
}

export function buildCompartmentResourceOutputsPathname(resourceName: string): string {
  return `${buildCompartmentResourcePathname(resourceName)}/outputs`;
}

export function buildCompartmentResourceBackupCollectionPathname(resourceName: string): string {
  return `${buildCompartmentResourcePathname(resourceName)}/backups`;
}

export function buildCompartmentResourceRestorePathname(resourceName: string): string {
  return `${buildCompartmentResourcePathname(resourceName)}/restore`;
}

export function buildCompartmentResourceStartPathname(resourceName: string): string {
  return `${buildCompartmentResourcePathname(resourceName)}/start`;
}

export function buildCompartmentResourceBootstrapPathname(resourceName: string): string {
  return `${buildCompartmentResourcePathname(resourceName)}/bootstrap`;
}

export function buildCompartmentResourceStopPathname(resourceName: string): string {
  return `${buildCompartmentResourcePathname(resourceName)}/stop`;
}

export function buildCompartmentResourcePathname(resourceName: string): string {
  return `${compartmentResourcesPathname}/${encodeURIComponent(resourceName)}`;
}

export function buildCompartmentUserAccessApiPathname(email: string): string {
  return `${buildCompartmentUserApiPathname(email)}/access`;
}

export function buildCompartmentUserBlockApiPathname(email: string): string {
  return `${buildCompartmentUserApiPathname(email)}/block`;
}

export function buildCompartmentUserUnblockApiPathname(email: string): string {
  return `${buildCompartmentUserApiPathname(email)}/unblock`;
}

export function buildCompartmentUserApiPathname(email: string): string {
  return `${compartmentUsersApiPathname}/${encodeURIComponent(email)}`;
}

export function buildCompartmentVariablePathname(keyName: string): string {
  return `${compartmentVariablesPathname}/${encodeURIComponent(keyName)}`;
}

export function buildCompartmentVariableBindingPathname(variableGroupName: string): string {
  return `${compartmentVariablesPathname}/bindings/${encodeURIComponent(variableGroupName)}`;
}

export function buildCompartmentVariableGroupUsagesPathname(variableGroupName: string): string {
  return `${buildCompartmentVariableGroupPathname(variableGroupName)}/usages`;
}

export function buildCompartmentVariableGroupPathname(variableGroupName: string): string {
  return `${compartmentVariableGroupsPathname}/${encodeURIComponent(variableGroupName)}`;
}

export const compartmentSystemDomainStatusPathname: string = '/internal/system/domain/status';
export const compartmentSystemDomainStatusRefreshPathname: string = '/internal/system/domain/status/refresh';
export const compartmentSystemDomainSetPathname: string = '/internal/system/domain/set';
export const compartmentSystemDomainVerifyPathname: string = '/internal/system/domain/verify';
export const compartmentSystemDomainActivatePathname: string = '/internal/system/domain/activate';
export const compartmentSystemDomainResetManagedPathname: string = '/internal/system/domain/reset-managed';
export const compartmentSystemIssuePasswordResetPathname: string = '/internal/system/auth/password-reset/issue';
