import { ApiBusinessError } from './api-business-error.shared';

export function createOrganizationSlugTakenError(): ApiBusinessError {
  return new ApiBusinessError('organization_slug_taken');
}

export function createProjectArchivedError(): ApiBusinessError {
  return new ApiBusinessError('project_archived');
}

export function createProjectDeleteBlockedError(): ApiBusinessError {
  return new ApiBusinessError('project_delete_blocked');
}

export function createProjectDeleteRequiresArchiveError(): ApiBusinessError {
  return new ApiBusinessError('project_delete_requires_archive');
}

export function createProjectDeleteRuntimeCleanupFailedError(cause?: Error): ApiBusinessError {
  return new ApiBusinessError('project_delete_runtime_cleanup_failed', undefined, { cause });
}

export function createProjectGitSourceBoundError(): ApiBusinessError {
  return new ApiBusinessError('project_git_source_bound');
}

export function createProjectArchiveRuntimeStopFailedError(): ApiBusinessError {
  return new ApiBusinessError('project_archive_runtime_stop_failed');
}

export function createProjectLifecycleBusyError(): ApiBusinessError {
  return new ApiBusinessError('project_lifecycle_busy');
}

export function createProjectLifecycleNotAvailableError(): ApiBusinessError {
  return new ApiBusinessError('project_lifecycle_not_available');
}

export function createProjectLifecycleRuntimeStopFailedError(): ApiBusinessError {
  return new ApiBusinessError('project_lifecycle_runtime_stop_failed');
}

export function createProjectNameTakenError(): ApiBusinessError {
  return new ApiBusinessError('project_name_taken');
}

export function createProjectNotDeployedError(): ApiBusinessError {
  return new ApiBusinessError('project_not_deployed');
}

export function createOrganizationNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('organization_not_found');
}

export function createProjectNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('project_not_found');
}

export function createProjectNotStartableError(): ApiBusinessError {
  return new ApiBusinessError('project_not_startable');
}

export function createRollbackServiceRequiredError(): ApiBusinessError {
  return new ApiBusinessError('rollback_service_required');
}

export function createRollbackRunTopologyMismatchError(): ApiBusinessError {
  return new ApiBusinessError('rollback_run_topology_mismatch');
}

export function createRollbackTargetNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('rollback_target_not_found');
}

export function createServiceNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('service_not_found');
}

export function createSourceAndTargetEnvironmentMatchError(): ApiBusinessError {
  return new ApiBusinessError('source_and_target_environment_match');
}

export function createResourceNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('resource_not_found');
}

export function createResourceBackupNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('resource_backup_not_found');
}

export function createSourceUploadAlreadyConsumedError(): ApiBusinessError {
  return new ApiBusinessError('source_upload_already_consumed');
}

export function createSourceUploadExpiredError(): ApiBusinessError {
  return new ApiBusinessError('source_upload_expired');
}

export function createSourceUploadNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('source_upload_not_found');
}

export function createSelfAdminMembershipChangeForbiddenError(): ApiBusinessError {
  return new ApiBusinessError('self_admin_membership_change_forbidden');
}

export function createUnsupportedServiceKindError(): ApiBusinessError {
  return new ApiBusinessError('unsupported_service_kind');
}

export function createVariableNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('variable_not_found');
}

export function createVariableCollisionError(message?: string): ApiBusinessError {
  return new ApiBusinessError('variable_collision', message);
}

export function createRouteNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('route_not_found');
}

export function createUserNotFoundError(): ApiBusinessError {
  return new ApiBusinessError('user_not_found');
}

export function createUserNotManageableError(): ApiBusinessError {
  return new ApiBusinessError('user_not_manageable');
}
