import {
  accessRoleListOptionsResponseSchema,
  accessRoleListPageResponseSchema,
  accessRoleListQuerySchema,
  accessRoleListResponseSchema,
  accessRoleListRouteResponseSchema,
  type AccessRoleListPageQuery,
  type AccessRoleListOptionsResponse,
  accessRoleResponseSchema,
  compartmentRolesPathname,
  createAccessRoleRequestSchema,
  updateAccessRoleRequestSchema,
  type AccessRoleListPageResponse,
  type AccessRoleListQuery,
  type AccessRoleListResponse,
  type AccessRoleListRouteResponse,
  type AccessRoleListRow,
  type AccessRoleResponse,
  type AccessRoleSummary,
  type CreateAccessRoleRequest,
  type UpdateAccessRoleRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { buildOrganizationRoleAuditMetadata } from '../../services/audit-event-metadata.service';
import { recordAuditEvent } from '../../services/audit-events.service';
import {
  createOrganizationAccessRole,
  deleteOrganizationAccessRole,
  listOrganizationAccessRoles,
  listOrganizationAccessRolesPage,
  readOrganizationAccessRole,
  updateOrganizationAccessRole,
} from '../../services/access-roles.service';
import type { OrganizationAccessRolesPageResult } from '../../services/access-roles.service.types';
import { synchronizeEdgeAppAccessState } from '../../services/app-access-edge.service';
import { buildAuditEventForRequest } from '../audit/audit-event-route-context';
import type { RouteAuditEventInput } from '../audit/audit-event-route-context.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildAccessRoleResponse } from './role.presenter';
import { roleRouteParamsSchema, type OrganizationRoleAuditEventType, type RoleRouteParams } from './role.route.types';

export function registerRoleRoutes(app: ApiApp): void {
  registerRoleListRoute(app);
  registerRoleCreateRoute(app);
  registerRoleReadRoute(app);
  registerRoleUpdateRoute(app);
  registerRoleDeleteRoute(app);
}

async function handleRoleList(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const query: AccessRoleListQuery = parseRequestValue(accessRoleListQuerySchema, request.query, 'invalid_role_query');
  const response: AccessRoleListRouteResponse = await buildRoleListResponse(request, query);
  return await reply.send(response);
}

async function buildRoleListResponse(
  request: FastifyRequest,
  query: AccessRoleListQuery,
): Promise<AccessRoleListRouteResponse> {
  if (query.detail === 'list') {
    return await buildRoleListPageResponse(request, query);
  }
  if (query.detail === 'options') {
    return await buildRoleListOptionsResponse(request);
  }

  return await buildRoleListLegacyResponse(request);
}

async function buildRoleListPageResponse(
  request: FastifyRequest,
  query: AccessRoleListPageQuery,
): Promise<AccessRoleListPageResponse> {
  const page: OrganizationAccessRolesPageResult = await listOrganizationAccessRolesPage({
    organizationId: request.currentOrganization.id,
    orderBy: query.orderBy,
    page: query.page,
    perPage: query.perPage,
    search: query.search,
    sort: query.sort,
  });

  return accessRoleListPageResponseSchema.parse({
    detail: 'list',
    pagination: page.pagination,
    roles: page.roles,
  });
}

async function buildRoleListOptionsResponse(request: FastifyRequest): Promise<AccessRoleListOptionsResponse> {
  const roles: AccessRoleListRow[] = await listOrganizationAccessRoles(request.currentOrganization.id);

  return accessRoleListOptionsResponseSchema.parse({
    detail: 'options',
    roles,
  });
}

async function buildRoleListLegacyResponse(request: FastifyRequest): Promise<AccessRoleListResponse> {
  const roles: AccessRoleListRow[] = await listOrganizationAccessRoles(request.currentOrganization.id);

  return accessRoleListResponseSchema.parse({ roles });
}

async function handleRoleCreate(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: CreateAccessRoleRequest = parseRequestValue(
    createAccessRoleRequestSchema,
    request.body,
    'invalid_role_request',
  );
  const role: AccessRoleSummary = await createOrganizationAccessRole({
    actorPrincipalId: request.actor.principalId,
    organizationId: request.currentOrganization.id,
    request: body,
  });
  const response: AccessRoleResponse = accessRoleResponseSchema.parse(buildAccessRoleResponse(role));
  await recordAuditEvent(
    buildAuditEventForRequest(request, buildRoleAuditEventInput(role, 'organization.role.created')),
  );

  return await reply.send(response);
}

async function handleRoleRead(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: RoleRouteParams = parseRequestValue(roleRouteParamsSchema, request.params, 'invalid_role_params');
  const role: AccessRoleSummary = await readOrganizationAccessRole(request.currentOrganization.id, params.roleId);
  const response: AccessRoleResponse = accessRoleResponseSchema.parse(buildAccessRoleResponse(role));

  return await reply.send(response);
}

async function handleRoleUpdate(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: RoleRouteParams = parseRequestValue(roleRouteParamsSchema, request.params, 'invalid_role_params');
  const body: UpdateAccessRoleRequest = parseRequestValue(
    updateAccessRoleRequestSchema,
    request.body,
    'invalid_role_request',
  );
  const role: AccessRoleSummary = await updateOrganizationAccessRole({
    actorPrincipalId: request.actor.principalId,
    organizationId: request.currentOrganization.id,
    request: body,
    roleId: params.roleId,
  });
  const response: AccessRoleResponse = accessRoleResponseSchema.parse(buildAccessRoleResponse(role));
  await recordAuditEvent(
    buildAuditEventForRequest(request, buildRoleAuditEventInput(role, 'organization.role.updated')),
  );
  await synchronizeEdgeAppAccessState();

  return await reply.send(response);
}

async function handleRoleDelete(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: RoleRouteParams = parseRequestValue(roleRouteParamsSchema, request.params, 'invalid_role_params');
  const role: AccessRoleSummary = await readOrganizationAccessRole(request.currentOrganization.id, params.roleId);
  await deleteOrganizationAccessRole({ organizationId: request.currentOrganization.id, roleId: params.roleId });
  const response: AccessRoleResponse = accessRoleResponseSchema.parse(buildAccessRoleResponse(role));
  await recordAuditEvent(
    buildAuditEventForRequest(request, buildRoleAuditEventInput(role, 'organization.role.deleted')),
  );
  await synchronizeEdgeAppAccessState();

  return await reply.send(response);
}

function buildRoleAuditEventInput(
  role: AccessRoleSummary,
  eventType: OrganizationRoleAuditEventType,
): RouteAuditEventInput {
  return {
    eventType,
    metadata: buildOrganizationRoleAuditMetadata({
      kind: role.kind,
      permissionCount: role.permissionKeys.length,
    }),
    target: {
      displayName: role.name,
      id: role.id,
      type: 'role',
    },
  };
}

function registerRoleListRoute(app: ApiApp): void {
  app.get(
    compartmentRolesPathname,
    createCurrentOrganizationRouteResponseOptions('organization.role.read', { 200: accessRoleListRouteResponseSchema }),
    handleRoleList,
  );
}

function registerRoleCreateRoute(app: ApiApp): void {
  app.post(
    compartmentRolesPathname,
    createCurrentOrganizationRouteResponseOptions('organization.role.manage', { 200: accessRoleResponseSchema }),
    handleRoleCreate,
  );
}

function registerRoleReadRoute(app: ApiApp): void {
  app.get(
    `${compartmentRolesPathname}/:roleId`,
    createCurrentOrganizationRouteResponseOptions('organization.role.read', { 200: accessRoleResponseSchema }),
    handleRoleRead,
  );
}

function registerRoleUpdateRoute(app: ApiApp): void {
  app.patch(
    `${compartmentRolesPathname}/:roleId`,
    createCurrentOrganizationRouteResponseOptions('organization.role.manage', { 200: accessRoleResponseSchema }),
    handleRoleUpdate,
  );
}

function registerRoleDeleteRoute(app: ApiApp): void {
  app.delete(
    `${compartmentRolesPathname}/:roleId`,
    createCurrentOrganizationRouteResponseOptions('organization.role.manage', { 200: accessRoleResponseSchema }),
    handleRoleDelete,
  );
}
