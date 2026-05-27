import type {
  AccessRoleKind,
  AccessRoleListOrderBy,
  ListPagination,
  ListSortDirection,
  PermissionKey,
} from '@compartment/contracts';

export interface ListAccessRolesPageInput {
  organizationId: string;
  orderBy: AccessRoleListOrderBy;
  page: number;
  perPage: number;
  search?: string | undefined;
  sort: ListSortDirection;
}

export interface AccessRoleListPageRow {
  assignmentCount: number;
  description: string | null;
  groupCount: number;
  id: string;
  kind: AccessRoleKind;
  name: string;
  permissionKeys: PermissionKey[];
  principalCount: number;
}

export interface AccessRoleListPageRecord {
  assignmentCount: number;
  description: string | null;
  groupCount: number;
  id: string;
  kind: AccessRoleKind;
  name: string;
  principalCount: number;
}

export interface AccessRolesPageResult {
  pagination: ListPagination;
  roles: AccessRoleListPageRow[];
}
