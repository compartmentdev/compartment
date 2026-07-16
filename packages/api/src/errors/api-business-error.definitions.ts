import type { ApiBusinessErrorCode, ApiBusinessErrorDefinition } from './api-business-error.types';
import { authBusinessErrorDefinitions } from './api-business-error.auth.definitions';
import { deploymentBusinessErrorDefinitions } from './api-business-error.deployment.definitions';
import { extraBusinessErrorDefinitions } from './api-business-error.extra.definitions';
import { resourceBusinessErrorDefinitions } from './api-business-error.resource.definitions';

export const businessErrorDefinitions: Record<ApiBusinessErrorCode, ApiBusinessErrorDefinition> = {
  ...authBusinessErrorDefinitions,
  ...deploymentBusinessErrorDefinitions,
  ...extraBusinessErrorDefinitions,
  ...resourceBusinessErrorDefinitions,
  already_installed: {
    message: 'The installation has already been initialized.',
    statusCode: 409,
  },
  invalid_deploy_config: {
    message: 'The compartment deploy configuration is invalid.',
    statusCode: 400,
  },
  descriptor_service_not_found: {
    message: 'The requested service was not found in the compartment descriptor.',
    statusCode: 400,
  },
  edge_state_update_failed: {
    message: 'The edge state could not be updated. Retry the operation.',
    statusCode: 502,
  },
  environment_not_found: {
    message: 'The requested environment was not found.',
    statusCode: 404,
  },
  forbidden: {
    message: 'The current principal is not allowed to perform this operation.',
    statusCode: 403,
  },
  git_source_bootstrap_invalid: {
    message: 'The Git source bootstrap request is invalid or expired.',
    statusCode: 400,
  },
  git_source_conflict: {
    message: 'The Git source conflicts with existing source bindings.',
    statusCode: 409,
  },
  git_source_not_found: { message: 'The requested Git source was not found.', statusCode: 404 },
  git_source_request_invalid: {
    message: 'The Git source webhook request is invalid.',
    statusCode: 400,
  },
  git_source_request_unauthorized: {
    message: 'The Git source webhook request could not be verified.',
    statusCode: 401,
  },
  git_source_registration_failed: {
    message: 'The GitHub App registration could not be completed.',
    statusCode: 409,
  },
  git_source_registration_pending: {
    message: 'Complete the GitHub App registration before connecting this source.',
    statusCode: 409,
  },
  git_source_repository_access_denied: {
    message: 'The GitHub App is not installed on the selected repository.',
    statusCode: 409,
  },
  git_source_repository_empty: {
    message: 'The selected repository is empty. Add at least one commit to it, then try again.',
    statusCode: 409,
  },
  custom_domain_collision: {
    message: 'The custom domain is already assigned.',
    statusCode: 409,
  },
  custom_domain_not_found: { message: 'The requested custom domain was not found.', statusCode: 404 },
  domain_idempotency_conflict: {
    message: 'The idempotency key was already used with a different request.',
    statusCode: 409,
  },
  domain_no_pending_operation: {
    message: 'No domain operation is pending.',
    statusCode: 409,
  },
  domain_operation_unavailable: {
    message: 'The pending domain operation cannot perform that step.',
    statusCode: 409,
  },
  domain_version_conflict: {
    message: 'Domain setup changed. Refresh status and retry.',
    statusCode: 409,
  },
  invalid_base_domain: {
    message: 'Base domain must be a valid hostname like example.com or localhost.',
    statusCode: 400,
  },
  invalid_domain_host_plan: {
    message: 'The domain host plan is invalid.',
    statusCode: 400,
  },
  invalid_organization_slug: {
    message: 'Organization slug must contain at least one letter or digit.',
    statusCode: 400,
  },
  invalid_source_upload: {
    message: 'The uploaded source archive is invalid.',
    statusCode: 400,
  },
  invalid_custom_domain: {
    message: 'The custom domain request is invalid.',
    statusCode: 400,
  },
  invalid_variable_target: { message: 'The variable target is invalid.', statusCode: 400 },
  invalid_variable_local_run: { message: 'The local variable run request is invalid.', statusCode: 400 },
  last_organization_admin: { message: 'Each organization must keep at least one admin.', statusCode: 409 },
  not_installed: {
    message: 'The compartment is not installed.',
    statusCode: 409,
  },
  onboarding_session_not_found: {
    message: 'The first deploy onboarding session was not found.',
    statusCode: 404,
  },
  organization_not_found: {
    message: 'The selected organization was not found for the current principal.',
    statusCode: 404,
  },
  organization_slug_taken: {
    message: 'An organization with this slug already exists.',
    statusCode: 409,
  },
  organization_user_exists: {
    message: 'The user already has access to the selected organization.',
    statusCode: 409,
  },
  project_archive_runtime_stop_failed: {
    message: 'The project was archived, but an active deployment could not be stopped. Retry the archive command.',
    statusCode: 502,
  },
  project_archived: {
    message: 'The requested project is archived.',
    statusCode: 409,
  },
  project_delete_blocked: {
    message: 'The project cannot be deleted while deployments are active, queued, or running.',
    statusCode: 409,
  },
  project_delete_requires_archive: {
    message: 'Archive the project before deleting it.',
    statusCode: 409,
  },
  project_delete_runtime_cleanup_failed: {
    message: 'The project runtime resources could not be removed. Retry the delete command.',
    statusCode: 502,
  },
  project_git_source_bound: {
    message: 'Disconnect the active Git source before mutating this project lifecycle.',
    statusCode: 409,
  },
  project_lifecycle_busy: {
    message: 'The project has queued or running deployments. Retry after the current deployment finishes.',
    statusCode: 409,
  },
  project_lifecycle_not_available: {
    message: 'Project lifecycle actions are not available for the current deployment state.',
    statusCode: 409,
  },
  project_lifecycle_runtime_stop_failed: {
    message: 'The project runtime could not be stopped. Retry the operation.',
    statusCode: 502,
  },
  project_name_taken: {
    message: 'A project with this name already exists in the selected organization.',
    statusCode: 409,
  },
  project_not_deployed: {
    message: 'The project has not been deployed yet.',
    statusCode: 409,
  },
  project_not_found: {
    message: 'The requested project was not found.',
    statusCode: 404,
  },
  project_not_startable: {
    message: 'The project does not have a reusable deployment artifact to start.',
    statusCode: 409,
  },
  route_not_found: {
    message: 'The requested application route was not found.',
    statusCode: 404,
  },
  self_admin_membership_change_forbidden: {
    message: 'Admin users cannot remove or demote their own organization access.',
    statusCode: 409,
  },
  service_not_found: {
    message: 'The requested service was not found.',
    statusCode: 404,
  },
  source_and_target_environment_match: {
    message: 'Source and target environments must be different.',
    statusCode: 409,
  },
  source_upload_already_consumed: {
    message: 'The source upload was already used for a deployment.',
    statusCode: 409,
  },
  source_upload_expired: {
    message: 'The source upload expired before deployment submission.',
    statusCode: 409,
  },
  source_upload_not_found: { message: 'The requested source upload was not found.', statusCode: 404 },
  variable_not_found: {
    message: 'The requested variable was not found for the selected target.',
    statusCode: 404,
  },
  variable_collision: {
    message: 'One or more variable keys conflict with the current target.',
    statusCode: 409,
  },
  variable_group_not_found: {
    message: 'The requested variable group was not found in the current organization.',
    statusCode: 404,
  },
  user_not_manageable: {
    message: 'This user is managed by the system and cannot be updated directly.',
    statusCode: 409,
  },
  user_not_found: { message: 'The requested user was not found in the selected organization.', statusCode: 404 },
};
