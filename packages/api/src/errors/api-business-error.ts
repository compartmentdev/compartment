import { compartmentGitLabTokenInvalidErrorCode } from '@compartment/contracts';
import { ApiBusinessError, isApiBusinessError } from './api-business-error.shared';

export { isApiBusinessError, mapApiBusinessError } from './api-business-error.shared';

export function createAlreadyInstalledError(): ApiBusinessError {
  return new ApiBusinessError('already_installed');
}
export function createAuditExportTooLargeError(message?: string): ApiBusinessError {
  return new ApiBusinessError('audit_export_too_large', message);
}
export function createActiveDeploymentNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('active_deployment_not_found');
}
export function createAccessAssignmentNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('access_assignment_not_found');
}
export function createAccessGroupNameTakenError(): ApiBusinessError {
  return new ApiBusinessError('access_group_name_taken');
}
export function createAccessGroupNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('access_group_not_found');
}
export function createAccessRoleImmutableError(): ApiBusinessError {
  return new ApiBusinessError('access_role_immutable');
}
export function createAccessRoleNameTakenError(): ApiBusinessError {
  return new ApiBusinessError('access_role_name_taken');
}
export function createAccessRoleNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('access_role_not_found');
}

export function createDeploymentImageNotAvailableError(): ApiBusinessError {
  return new ApiBusinessError('deployment_image_not_available');
}

export function createDeploymentImageCleanedError(): ApiBusinessError {
  return new ApiBusinessError('deployment_image_cleaned');
}

export function createDeploymentTargetBusyError(): ApiBusinessError {
  return new ApiBusinessError('deployment_target_busy');
}

export function createDescriptorServiceNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('descriptor_service_not_found');
}

export function createInvalidDeployConfigError(message?: string): ApiBusinessError {
  return new ApiBusinessError('invalid_deploy_config', message);
}

export function createDeploymentNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('deployment_not_found');
}

export function createEdgeStateUpdateFailedError(): ApiBusinessError {
  return new ApiBusinessError('edge_state_update_failed');
}

export function createEnvironmentNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('environment_not_found');
}

export function createForbiddenError(): ApiBusinessError {
  return new ApiBusinessError('forbidden');
}

export function createGitSourceBootstrapInvalidError(message?: string): ApiBusinessError {
  return new ApiBusinessError('git_source_bootstrap_invalid', message);
}

export function createGitSourceConflictError(message?: string): ApiBusinessError {
  return new ApiBusinessError('git_source_conflict', message);
}

export function createGitSourceNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('git_source_not_found');
}

export function createGitSourceRequestInvalidError(message?: string): ApiBusinessError {
  return new ApiBusinessError('git_source_request_invalid', message);
}

export function createGitSourceRequestUnauthorizedError(message?: string): ApiBusinessError {
  return new ApiBusinessError('git_source_request_unauthorized', message);
}

export function createGitSourceRegistrationFailedError(message?: string): ApiBusinessError {
  return new ApiBusinessError('git_source_registration_failed', message);
}

export function createGitSourceRegistrationPendingError(): ApiBusinessError {
  return new ApiBusinessError('git_source_registration_pending');
}

export function createGitLabTokenInvalidError(message?: string): ApiBusinessError {
  return new ApiBusinessError(compartmentGitLabTokenInvalidErrorCode, message);
}

export function createGitSourceRepositoryAccessDeniedError(message?: string): ApiBusinessError {
  return new ApiBusinessError('git_source_repository_access_denied', message);
}

export function createGitSourceRepositoryEmptyError(message?: string): ApiBusinessError {
  return new ApiBusinessError('git_source_repository_empty', message);
}

export function isGitSourceRepositoryAccessDeniedError(value: Error | null | undefined): value is ApiBusinessError {
  return isApiBusinessError(value) && value.code === 'git_source_repository_access_denied';
}

export function createCustomDomainCollisionError(message?: string): ApiBusinessError {
  return new ApiBusinessError('custom_domain_collision', message);
}

export function createCustomDomainNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('custom_domain_not_found');
}

export function createDomainIdempotencyConflictError(): ApiBusinessError {
  return new ApiBusinessError('domain_idempotency_conflict');
}

export function createDomainNoPendingOperationError(): ApiBusinessError {
  return new ApiBusinessError('domain_no_pending_operation');
}

export function createDomainOperationUnavailableError(message?: string): ApiBusinessError {
  return new ApiBusinessError('domain_operation_unavailable', message);
}

export function createDomainVersionConflictError(): ApiBusinessError {
  return new ApiBusinessError('domain_version_conflict');
}

export function createInvalidCredentialsError(): ApiBusinessError {
  return new ApiBusinessError('invalid_credentials');
}

export function createInvalidCliLoginError(): ApiBusinessError {
  return new ApiBusinessError('invalid_cli_login');
}

export function createInvalidBaseDomainError(): ApiBusinessError {
  return new ApiBusinessError('invalid_base_domain');
}

export function createInvalidDomainHostPlanError(message?: string): ApiBusinessError {
  return new ApiBusinessError('invalid_domain_host_plan', message);
}

export function createInvalidOrganizationSlugError(): ApiBusinessError {
  return new ApiBusinessError('invalid_organization_slug');
}

export function createInvalidSourceUploadError(message?: string): ApiBusinessError {
  return new ApiBusinessError('invalid_source_upload', message);
}

export function createInvalidAppAccessCodeError(): ApiBusinessError {
  return new ApiBusinessError('invalid_app_access_code');
}

export function createInvalidBootstrapTokenError(): ApiBusinessError {
  return new ApiBusinessError('invalid_bootstrap_token');
}

export function createInvalidPasswordResetTokenError(): ApiBusinessError {
  return new ApiBusinessError('invalid_password_reset_token');
}

export function createInvalidBrowserFlowError(): ApiBusinessError {
  return new ApiBusinessError('invalid_browser_flow');
}

export function createInvalidCustomDomainError(message?: string): ApiBusinessError {
  return new ApiBusinessError('invalid_custom_domain', message);
}

export function createNodeUnavailableError(): ApiBusinessError {
  return new ApiBusinessError('node_unavailable');
}

export function createInvalidSsoLoginError(): ApiBusinessError {
  return new ApiBusinessError('invalid_sso_login');
}

export function createInvalidSsoProviderConfigError(message?: string): ApiBusinessError {
  return new ApiBusinessError('invalid_sso_provider_config', message);
}

export function createInvalidVariableLocalRunError(message?: string): ApiBusinessError {
  return new ApiBusinessError('invalid_variable_local_run', message);
}

export function createInvalidVariableTargetError(message?: string): ApiBusinessError {
  return new ApiBusinessError('invalid_variable_target', message);
}

export function createResourceNameTakenError(message?: string): ApiBusinessError {
  return new ApiBusinessError('resource_name_taken', message);
}

export function createLastOrganizationAdminError(): ApiBusinessError {
  return new ApiBusinessError('last_organization_admin');
}

export function createLoginMethodRequiredError(): ApiBusinessError {
  return new ApiBusinessError('login_method_required');
}

export function createNotInstalledError(): ApiBusinessError {
  return new ApiBusinessError('not_installed');
}

export function createOnboardingSessionNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('onboarding_session_not_found');
}

export function createOrganizationUserExistsError(): ApiBusinessError {
  return new ApiBusinessError('organization_user_exists');
}

export function createPasswordResetNotAvailableError(): ApiBusinessError {
  return new ApiBusinessError('password_reset_not_available');
}

export function createPasswordResetUserNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('password_reset_user_not_found');
}

export * from './api-business-error.extra';

export function createVariableGroupNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('variable_group_not_found');
}
