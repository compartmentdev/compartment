import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  captureVariableGroupResponseSchema,
  compartmentVariableGroupCapturePathname,
  type CaptureVariableGroupResponse,
} from '@compartment/contracts';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { captureVariableGroupForPrincipal } from '../../services/variable-groups.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildCaptureVariableGroupResponse } from './variable-group.presenter';
import { captureVariableGroupBodySchema, type CaptureVariableGroupRequest } from './variable-group.route.types';

export function registerPostCaptureVariableGroupRoute(app: ApiApp): void {
  app.post(
    compartmentVariableGroupCapturePathname,
    createCurrentOrganizationRouteResponseOptions('variable.write', { 200: captureVariableGroupResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      await reply.send(await executePostCaptureVariableGroupRequest(request)),
  );
}

async function executePostCaptureVariableGroupRequest(request: FastifyRequest): Promise<CaptureVariableGroupResponse> {
  const body: CaptureVariableGroupRequest = parseRequestValue(
    captureVariableGroupBodySchema,
    request.body,
    'invalid_variable_group_body',
  );

  return captureVariableGroupResponseSchema.parse(
    buildCaptureVariableGroupResponse(
      await captureVariableGroupForPrincipal({
        effective: body.effective,
        environmentName: body.environmentName,
        organizationId: request.currentOrganization.id,
        organizationSlug: request.currentOrganization.slug,
        principalId: request.actor.principalId,
        projectName: body.projectName,
        resourceName: body.resourceName,
        serviceName: body.serviceName,
        variableGroupName: body.variableGroupName,
      }),
    ),
  );
}
