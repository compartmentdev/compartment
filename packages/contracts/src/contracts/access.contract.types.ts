export type AppAccessScopeType = 'organization' | 'project' | 'environment';
export type AccessAssignmentScopeType = 'organization' | 'project' | 'environment';
export type AccessSummaryLabel = 'Custom' | 'Deploy' | 'Full access' | 'Limited view' | 'Membership only' | 'Read-only';
export type CompartmentMembershipRole = 'admin' | 'deployer' | 'readonly' | 'viewer';
export type AccessRoleKind = 'custom' | 'system';
export type PermissionFamilyId =
  | 'access-management'
  | 'audit-logs'
  | 'deployments'
  | 'domains-routing'
  | 'project-setup'
  | 'runtime-configuration';
export type PermissionKey =
  | 'organization.project.create'
  | 'organization.user.read'
  | 'organization.user.invite'
  | 'organization.user.block'
  | 'organization.user.remove'
  | 'organization.user.credentials.reset'
  | 'organization.group.read'
  | 'organization.group.manage'
  | 'organization.role.read'
  | 'organization.role.manage'
  | 'organization.auth.manage'
  | 'organization.settings.manage'
  | 'organization.audit.read'
  | 'project.read'
  | 'project.settings.write'
  | 'project.archive'
  | 'project.delete'
  | 'environment.read'
  | 'project.lifecycle.write'
  | 'deployment.read'
  | 'deployment.create'
  | 'deployment.promote'
  | 'deployment.rollback'
  | 'deployment.logs.read'
  | 'deployment.inspect'
  | 'variable.metadata.read'
  | 'variable.value.read'
  | 'variable.write'
  | 'variable.local_run'
  | 'domain.read'
  | 'domain.write'
  | 'source.read'
  | 'source.manage'
  | 'app.route.access';
export type AppRouteAccessMode = 'authenticated' | 'public';

export interface PermissionFamilyDefinition {
  id: PermissionFamilyId;
  label: string;
  permissionKeys: PermissionKey[];
}
