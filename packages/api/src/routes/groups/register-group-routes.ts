import {
  accessGroupListResponseSchema,
  accessGroupMemberListResponseSchema,
  accessGroupResponseSchema,
  addAccessGroupMemberRequestSchema,
  compartmentGroupsPathname,
  compartmentGroupMembersPathnameSuffix,
  createAccessGroupRequestSchema,
  updateAccessGroupRequestSchema,
  type AccessGroupListResponse,
  type AccessGroupMemberListResponse,
  type AccessGroupResponse,
  type AddAccessGroupMemberRequest,
  type CreateAccessGroupRequest,
  type UpdateAccessGroupRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '../../http/request.types';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { recordAuditEvent } from '../../services/audit-events.service';
import type {
  AccessGroupListRowResult,
  AccessGroupMemberMutationResult,
  AccessGroupMemberResult,
  AccessGroupResult,
} from '../../services/access-groups.service.types';
import {
  addOrganizationAccessGroupMember,
  createOrganizationAccessGroup,
  deleteOrganizationAccessGroup,
  listOrganizationAccessGroupMembers,
  listOrganizationAccessGroups,
  readOrganizationAccessGroup,
  removeOrganizationAccessGroupMember,
  updateOrganizationAccessGroup,
} from '../../services/access-groups.service';
import { synchronizeEdgeAppAccessState } from '../../services/app-access-edge.service';
import { buildAuditEventForRequest } from '../audit/audit-event-route-context';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildGroupAuditEventInput, buildGroupMemberAuditEventInput } from './group-audit-route';
import { buildAccessGroupListRows, buildAccessGroupMembersResponse, buildAccessGroupResponse } from './group.presenter';
import {
  groupMemberRouteParamsSchema,
  groupRouteParamsSchema,
  type GroupMemberRouteParams,
  type GroupRouteParams,
} from './group.route.types';

export function registerGroupRoutes(app: ApiApp): void {
  registerGroupCrudRoutes(app);
  registerGroupMemberRoutes(app);
}

function registerGroupCrudRoutes(app: ApiApp): void {
  registerGroupListCreateRoutes(app);
  registerGroupItemRoutes(app);
}

function registerGroupListCreateRoutes(app: ApiApp): void {
  app.get(
    compartmentGroupsPathname,
    createCurrentOrganizationRouteResponseOptions('organization.group.read', { 200: accessGroupListResponseSchema }),
    handleGroupList,
  );
  app.post(
    compartmentGroupsPathname,
    createCurrentOrganizationRouteResponseOptions('organization.group.manage', { 200: accessGroupResponseSchema }),
    handleGroupCreate,
  );
}

function registerGroupItemRoutes(app: ApiApp): void {
  app.get(
    `${compartmentGroupsPathname}/:groupId`,
    createCurrentOrganizationRouteResponseOptions('organization.group.read', { 200: accessGroupResponseSchema }),
    handleGroupRead,
  );
  app.patch(
    `${compartmentGroupsPathname}/:groupId`,
    createCurrentOrganizationRouteResponseOptions('organization.group.manage', { 200: accessGroupResponseSchema }),
    handleGroupUpdate,
  );
  app.delete(
    `${compartmentGroupsPathname}/:groupId`,
    createCurrentOrganizationRouteResponseOptions('organization.group.manage', { 200: accessGroupResponseSchema }),
    handleGroupDelete,
  );
}

function registerGroupMemberRoutes(app: ApiApp): void {
  app.get(
    `${compartmentGroupsPathname}/:groupId${compartmentGroupMembersPathnameSuffix}`,
    createCurrentOrganizationRouteResponseOptions('organization.group.read', {
      200: accessGroupMemberListResponseSchema,
    }),
    handleGroupMembersList,
  );
  app.post(
    `${compartmentGroupsPathname}/:groupId${compartmentGroupMembersPathnameSuffix}`,
    createCurrentOrganizationRouteResponseOptions('organization.group.manage', {
      200: accessGroupMemberListResponseSchema,
    }),
    handleGroupMemberAdd,
  );
  app.delete(
    `${compartmentGroupsPathname}/:groupId${compartmentGroupMembersPathnameSuffix}/:email`,
    createCurrentOrganizationRouteResponseOptions('organization.group.manage', {
      200: accessGroupMemberListResponseSchema,
    }),
    handleGroupMemberDelete,
  );
}

async function handleGroupList(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const groups: AccessGroupListRowResult[] = await listOrganizationAccessGroups(request.currentOrganization.id);
  const response: AccessGroupListResponse = accessGroupListResponseSchema.parse({
    groups: buildAccessGroupListRows(groups),
  });

  return await reply.send(response);
}

async function handleGroupCreate(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: CreateAccessGroupRequest = parseRequestValue(
    createAccessGroupRequestSchema,
    request.body,
    'invalid_group_request',
  );
  const group: AccessGroupResult = await createOrganizationAccessGroup(request.currentOrganization.id, body);
  const response: AccessGroupResponse = accessGroupResponseSchema.parse(buildAccessGroupResponse(group));
  await recordAuditEvent(
    buildAuditEventForRequest(request, buildGroupAuditEventInput(group, 'organization.group.created')),
  );

  return await reply.send(response);
}

async function handleGroupRead(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GroupRouteParams = parseRequestValue(groupRouteParamsSchema, request.params, 'invalid_group_params');
  const group: AccessGroupResult = await readOrganizationAccessGroup(request.currentOrganization.id, params.groupId);
  const response: AccessGroupResponse = accessGroupResponseSchema.parse(buildAccessGroupResponse(group));

  return await reply.send(response);
}

async function handleGroupUpdate(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GroupRouteParams = parseRequestValue(groupRouteParamsSchema, request.params, 'invalid_group_params');
  const body: UpdateAccessGroupRequest = parseRequestValue(
    updateAccessGroupRequestSchema,
    request.body,
    'invalid_group_request',
  );
  const group: AccessGroupResult = await updateOrganizationAccessGroup(
    request.currentOrganization.id,
    params.groupId,
    body,
  );
  const response: AccessGroupResponse = accessGroupResponseSchema.parse(buildAccessGroupResponse(group));
  await recordAuditEvent(
    buildAuditEventForRequest(request, buildGroupAuditEventInput(group, 'organization.group.updated')),
  );

  return await reply.send(response);
}

async function handleGroupDelete(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GroupRouteParams = parseRequestValue(groupRouteParamsSchema, request.params, 'invalid_group_params');
  const group: AccessGroupResult = await readOrganizationAccessGroup(request.currentOrganization.id, params.groupId);
  await deleteOrganizationAccessGroup(request.currentOrganization.id, params.groupId);
  const response: AccessGroupResponse = accessGroupResponseSchema.parse(buildAccessGroupResponse(group));
  await recordAuditEvent(
    buildAuditEventForRequest(request, buildGroupAuditEventInput(group, 'organization.group.deleted')),
  );
  await synchronizeEdgeAppAccessState();

  return await reply.send(response);
}

async function handleGroupMembersList(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GroupRouteParams = parseRequestValue(groupRouteParamsSchema, request.params, 'invalid_group_params');
  const members: AccessGroupMemberResult[] = await listOrganizationAccessGroupMembers(
    request.currentOrganization.id,
    params.groupId,
  );
  const response: AccessGroupMemberListResponse = accessGroupMemberListResponseSchema.parse(
    buildAccessGroupMembersResponse(members),
  );

  return await reply.send(response);
}

async function handleGroupMemberAdd(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GroupRouteParams = parseRequestValue(groupRouteParamsSchema, request.params, 'invalid_group_params');
  const body: AddAccessGroupMemberRequest = parseRequestValue(
    addAccessGroupMemberRequestSchema,
    request.body,
    'invalid_group_member_request',
  );
  const result: AccessGroupMemberMutationResult = await addOrganizationAccessGroupMember({
    actorPrincipalId: request.actor.principalId,
    groupId: params.groupId,
    organizationId: request.currentOrganization.id,
    request: body,
  });
  const group: AccessGroupResult = await readOrganizationAccessGroup(request.currentOrganization.id, params.groupId);
  if (result.changed) {
    await recordAuditEvent(
      buildAuditEventForRequest(
        request,
        buildGroupMemberAuditEventInput(group, body.email, 'organization.group.member_added'),
      ),
    );
    await synchronizeEdgeAppAccessState();
  }

  return await reply.send(accessGroupMemberListResponseSchema.parse(buildAccessGroupMembersResponse(result.members)));
}

async function handleGroupMemberDelete(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GroupMemberRouteParams = parseGroupMemberRouteParams(request);
  const result: AccessGroupMemberMutationResult = await removeOrganizationAccessGroupMember(
    request.currentOrganization.id,
    params.groupId,
    params.email,
  );
  const group: AccessGroupResult = await readOrganizationAccessGroup(request.currentOrganization.id, params.groupId);
  const response: AccessGroupMemberListResponse = accessGroupMemberListResponseSchema.parse(
    buildAccessGroupMembersResponse(result.members),
  );
  if (result.changed) {
    await recordAuditEvent(
      buildAuditEventForRequest(
        request,
        buildGroupMemberAuditEventInput(group, params.email, 'organization.group.member_removed'),
      ),
    );
    await synchronizeEdgeAppAccessState();
  }

  return await reply.send(response);
}

function parseGroupMemberRouteParams(request: FastifyRequest): GroupMemberRouteParams {
  return parseRequestValue(groupMemberRouteParamsSchema, request.params, 'invalid_group_member_params');
}
