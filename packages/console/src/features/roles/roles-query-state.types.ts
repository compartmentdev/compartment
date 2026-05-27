import type { AccessRoleListPageResponse, AccessRoleResponse } from '@compartment/contracts/browser';
import type { QueryKey } from '@tanstack/react-query';

export interface RolesPageQueryData {
  role: AccessRoleResponse | undefined;
  roles: AccessRoleListPageResponse;
}

export interface RolesPageQueryKeys {
  role: QueryKey;
  roles: QueryKey;
}
