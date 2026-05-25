import type { PermissionKey } from '@compartment/contracts';
import type { OrganizationRow } from '../queries/organizations.query.types';
import type { ProjectRow } from '../queries/projects.query.types';

export interface ResolvedProjectScope {
  organization: OrganizationRow;
  project: ProjectRow;
}

export interface ProjectScopePermissionOptions {
  createPermission?: PermissionKey | undefined;
  permission?: PermissionKey | undefined;
}
