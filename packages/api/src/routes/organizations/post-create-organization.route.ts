import {
  buildFastifyResponseSchemas,
  compartmentOrganizationsPathname,
  createOrganizationRequestSchema,
  createOrganizationResponseSchema,
  type FastifyResponseSchemas,
  type CreateOrganizationRequest,
  type CreateOrganizationResponse,
  type OrganizationSummary,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { requireAnySessionVisibleOrganizationAdminAccess } from '../../services/access-scope.service';
import { recordAuditEvent } from '../../services/audit-events.service';
import { createOrganization } from '../../services/create-organization.service';
import type { CreateOrganizationResult } from '../../services/create-organization.service.types';
import { buildInstallationAuditEventForRequest } from '../audit/audit-event-route-context';
import { buildOrganizationSummaries } from '../presenters/organization.presenter';
import { buildOperationSummary } from '../presenters/operation.presenter';

interface CreateOrganizationRouteOptions {
  schema: {
    response: FastifyResponseSchemas;
  };
}

export function registerPostCreateOrganizationRoute(app: ApiApp): void {
  app.post(compartmentOrganizationsPathname, createOrganizationRouteOptions, handlePostCreateOrganization);
}

const createOrganizationRouteOptions: CreateOrganizationRouteOptions = {
  schema: {
    response: buildFastifyResponseSchemas({
      200: createOrganizationResponseSchema,
    }),
  },
};

async function handlePostCreateOrganization(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireAnySessionVisibleOrganizationAdminAccess(request.actor.authSession);
  const input: CreateOrganizationRequest = parseRequestValue(
    createOrganizationRequestSchema,
    request.body,
    'invalid_create_organization_request',
  );
  const result: CreateOrganizationResult = await createOrganization({
    name: input.name,
    principalId: request.actor.principalId,
    slug: input.slug,
  });
  await recordOrganizationCreatedAudit(request, result);
  const organization: OrganizationSummary | undefined = buildOrganizationSummaries([result.organization])[0];
  const response: CreateOrganizationResponse = createOrganizationResponseSchema.parse({
    operation: buildOperationSummary(result.operation),
    organization,
  });

  return await reply.send(response);
}

async function recordOrganizationCreatedAudit(
  request: FastifyRequest,
  result: CreateOrganizationResult,
): Promise<void> {
  await recordAuditEvent(
    buildInstallationAuditEventForRequest(request, {
      eventType: 'installation.organization.created',
      metadata: { organizationSlug: result.organization.slug },
      target: {
        displayName: result.organization.name,
        id: result.organization.id,
        type: 'organization',
      },
    }),
  );
}
