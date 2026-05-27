import {
  accessRoleListOptionsResponseSchema,
  accessRoleListResponseSchema,
  accessRoleResponseSchema,
  compartmentRolesPathname,
  createAccessRoleRequestSchema,
  type AccessRoleListOptionsResponse,
  updateAccessRoleRequestSchema,
  type AccessRoleListResponse,
  type AccessRoleResponse,
  type CreateAccessRoleRequest,
  type UpdateAccessRoleRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildAccessListOptionsPath } from './access-list-path.service';

export async function listAccessRoles(request: CompartmentRequester): Promise<AccessRoleListResponse> {
  const response: AccessRoleListOptionsResponse = await listAccessRoleOptions(request);
  return accessRoleListResponseSchema.parse({ roles: response.roles });
}

async function listAccessRoleOptions(request: CompartmentRequester): Promise<AccessRoleListOptionsResponse> {
  return await request({
    method: 'GET',
    path: buildAccessListOptionsPath(compartmentRolesPathname),
    schema: accessRoleListOptionsResponseSchema,
  });
}

export async function getAccessRole(request: CompartmentRequester, roleId: string): Promise<AccessRoleResponse> {
  return await request({
    method: 'GET',
    path: `${compartmentRolesPathname}/${encodeURIComponent(roleId)}`,
    schema: accessRoleResponseSchema,
  });
}

export async function createAccessRole(
  request: CompartmentRequester,
  body: CreateAccessRoleRequest,
): Promise<AccessRoleResponse> {
  return await request({
    body: createAccessRoleRequestSchema.parse(body),
    method: 'POST',
    path: compartmentRolesPathname,
    schema: accessRoleResponseSchema,
  });
}

export async function updateAccessRole(
  request: CompartmentRequester,
  roleId: string,
  body: UpdateAccessRoleRequest,
): Promise<AccessRoleResponse> {
  return await request({
    body: updateAccessRoleRequestSchema.parse(body),
    method: 'PATCH',
    path: `${compartmentRolesPathname}/${encodeURIComponent(roleId)}`,
    schema: accessRoleResponseSchema,
  });
}

export async function deleteAccessRole(request: CompartmentRequester, roleId: string): Promise<AccessRoleResponse> {
  return await request({
    method: 'DELETE',
    path: `${compartmentRolesPathname}/${encodeURIComponent(roleId)}`,
    schema: accessRoleResponseSchema,
  });
}
