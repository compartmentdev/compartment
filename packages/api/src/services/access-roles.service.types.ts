import type { CreateAccessRoleRequest, UpdateAccessRoleRequest } from '@compartment/contracts';

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
