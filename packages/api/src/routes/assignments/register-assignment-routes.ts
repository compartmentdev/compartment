import {
  accessAssignmentListResponseSchema,
  accessAssignmentResponseSchema,
  accessAssignmentScopeOptionsResponseSchema,
  compartmentAssignmentsPathname,
  compartmentAssignmentScopeOptionsPathname,
  createAccessAssignmentRequestSchema,
  type AccessAssignmentListResponse,
  type AccessAssignmentResponse,
  type AccessAssignmentScopeOptionsResponse,
  type CreateAccessAssignmentRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '../../http/request.types';
import type { ApiApp } from '../../app.types';
import { createAccessAssignmentNotFoundError } from '../../errors/api-business-error';
import { parseRequestValue } from '../../http/validation';
import { buildOrganizationAssignmentAuditMetadata } from '../../services/audit-event-metadata.service';
import { recordAuditEvent } from '../../services/audit-events.service';
import { deleteOrganizationAccessAssignment } from '../../services/access-assignment-delete.service';
import {
  createOrganizationAccessAssignment,
  listOrganizationAccessAssignments,
} from '../../services/access-assignments.service';
import type {
  AccessAssignmentMutationResult,
  AccessAssignmentResult,
} from '../../services/access-assignments.service.types';
import { synchronizeEdgeAppAccessState } from '../../services/app-access-edge.service';
import { listOrganizationAccessAssignmentScopeProjects } from '../../services/access-assignment-scope-options.service';
import type { AccessAssignmentScopeProjectResult } from '../../services/access-assignment-scope-options.service.types';
import { buildAuditEventForRequest } from '../audit/audit-event-route-context';
import type { RouteAuditEventInput } from '../audit/audit-event-route-context.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import {
  buildAccessAssignmentListResponse,
  buildAccessAssignmentResponse,
  buildAccessAssignmentScopeOptionsResponse,
} from './assignment.presenter';
import {
  assignmentRouteParamsSchema,
  type AssignmentRouteParams,
  type OrganizationAssignmentAuditEventType,
} from './assignment.route.types';

export function registerAssignmentRoutes(app: ApiApp): void {
  registerAssignmentScopeOptionsRoute(app);
  registerAssignmentListRoute(app);
  registerAssignmentCreateRoute(app);
  registerAssignmentDeleteRoute(app);
}

function registerAssignmentScopeOptionsRoute(app: ApiApp): void {
  app.get(
    compartmentAssignmentScopeOptionsPathname,
    createCurrentOrganizationRouteResponseOptions('organization.role.read', {
      200: accessAssignmentScopeOptionsResponseSchema,
    }),
    handleAssignmentScopeOptionsList,
  );
}

function registerAssignmentListRoute(app: ApiApp): void {
  app.get(
    compartmentAssignmentsPathname,
    createCurrentOrganizationRouteResponseOptions('organization.role.read', {
      200: accessAssignmentListResponseSchema,
    }),
    handleAssignmentList,
  );
}

function registerAssignmentCreateRoute(app: ApiApp): void {
  app.post(
    compartmentAssignmentsPathname,
    createCurrentOrganizationRouteResponseOptions('organization.role.manage', {
      200: accessAssignmentResponseSchema,
    }),
    handleAssignmentCreate,
  );
}

function registerAssignmentDeleteRoute(app: ApiApp): void {
  app.delete(
    `${compartmentAssignmentsPathname}/:assignmentId`,
    createCurrentOrganizationRouteResponseOptions('organization.role.manage', {
      200: accessAssignmentResponseSchema,
    }),
    handleAssignmentDelete,
  );
}

async function handleAssignmentScopeOptionsList(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const projects: AccessAssignmentScopeProjectResult[] = await listOrganizationAccessAssignmentScopeProjects(
    request.currentOrganization.id,
  );
  const response: AccessAssignmentScopeOptionsResponse = accessAssignmentScopeOptionsResponseSchema.parse(
    buildAccessAssignmentScopeOptionsResponse(projects),
  );

  return await reply.send(response);
}

async function handleAssignmentList(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const assignments: AccessAssignmentResult[] = await listOrganizationAccessAssignments(request.currentOrganization.id);
  const response: AccessAssignmentListResponse = accessAssignmentListResponseSchema.parse(
    buildAccessAssignmentListResponse(assignments),
  );

  return await reply.send(response);
}

async function handleAssignmentCreate(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: CreateAccessAssignmentRequest = parseRequestValue(
    createAccessAssignmentRequestSchema,
    request.body,
    'invalid_assignment_request',
  );
  const result: AccessAssignmentMutationResult = await createOrganizationAccessAssignment({
    actorPrincipalId: request.actor.principalId,
    organizationId: request.currentOrganization.id,
    request: body,
  });
  const assignment: AccessAssignmentResult = result.assignment;
  const response: AccessAssignmentResponse = accessAssignmentResponseSchema.parse(
    buildAccessAssignmentResponse(assignment),
  );
  if (result.created) {
    await recordAuditEvent(
      buildAuditEventForRequest(request, buildAssignmentAuditEventInput(assignment, 'organization.assignment.created')),
    );
    await synchronizeEdgeAppAccessState();
  }

  return await reply.send(response);
}

async function handleAssignmentDelete(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: AssignmentRouteParams = parseAssignmentRouteParams(request);
  const assignment: AccessAssignmentResult = await readAccessAssignmentOrThrow(
    request.currentOrganization.id,
    params.assignmentId,
  );
  await deleteOrganizationAccessAssignment({
    actorPrincipalId: request.actor.principalId,
    assignmentId: params.assignmentId,
    organizationId: request.currentOrganization.id,
  });
  const response: AccessAssignmentResponse = accessAssignmentResponseSchema.parse(
    buildAccessAssignmentResponse(assignment),
  );
  const auditEvent: RouteAuditEventInput = buildAssignmentAuditEventInput(
    assignment,
    'organization.assignment.deleted',
  );
  await recordAuditEvent(buildAuditEventForRequest(request, auditEvent));
  await synchronizeEdgeAppAccessState();

  return await reply.send(response);
}

function parseAssignmentRouteParams(request: FastifyRequest): AssignmentRouteParams {
  return parseRequestValue(assignmentRouteParamsSchema, request.params, 'invalid_assignment_params');
}

async function readAccessAssignmentOrThrow(
  organizationId: string,
  assignmentId: string,
): Promise<AccessAssignmentResult> {
  const assignment: AccessAssignmentResult | undefined = (await listOrganizationAccessAssignments(organizationId)).find(
    (item: AccessAssignmentResult): boolean => item.id === assignmentId,
  );
  if (assignment === undefined) {
    throw createAccessAssignmentNotFoundError();
  }

  return assignment;
}

function buildAssignmentAuditEventInput(
  assignment: AccessAssignmentResult,
  eventType: OrganizationAssignmentAuditEventType,
): RouteAuditEventInput {
  return {
    eventType,
    metadata: buildOrganizationAssignmentAuditMetadata({
      roleName: assignment.roleName,
      scope: assignment.scope,
      subject: assignment.subject,
    }),
    target: {
      displayName: assignment.roleName,
      id: assignment.id,
      type: 'assignment',
    },
  };
}
