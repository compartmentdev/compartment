import type {
  AccessRoleKind,
  AccessRoleListOrderBy,
  CreateAccessRoleRequest,
  ListSortDirection,
  PermissionKey,
  UpdateAccessRoleRequest,
} from '@compartment/contracts';
import type { ListPagination } from './list-pagination.service.helpers';

export interface CreateOrganizationAccessRoleInput {
  actorPrincipalId: string;
  organizationId: string;
  request: CreateAccessRoleRequest;
}

export interface UpdateOrganizationAccessRoleInput {
  actorPrincipalId: string;
  organizationId: string;
  request: UpdateAccessRoleRequest;
  roleId: string;
}

export interface DeleteOrganizationAccessRoleInput {
  organizationId: string;
  roleId: string;
}

export interface ListOrganizationAccessRolesPageInput {
  organizationId: string;
  orderBy?: AccessRoleListOrderBy | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  search?: string | undefined;
  sort?: ListSortDirection | undefined;
}

export interface AccessRoleListRowResult {
  assignmentCount: number;
  description: string | null;
  groupCount: number;
  id: string;
  kind: AccessRoleKind;
  name: string;
  permissionKeys: PermissionKey[];
  principalCount: number;
}

export interface OrganizationAccessRolesPageResult {
  pagination: ListPagination;
  roles: AccessRoleListRowResult[];
}
