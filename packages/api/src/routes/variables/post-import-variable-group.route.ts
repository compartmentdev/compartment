import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  compartmentVariableGroupImportPathname,
  importVariableGroupResponseSchema,
  type ImportVariableGroupResponse,
} from '@compartment/contracts';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { importVariableGroupForPrincipal } from '../../services/variable-groups.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildImportVariableGroupResponse } from './variable-group.presenter';
import { importVariableGroupBodySchema, type ImportVariableGroupRequest } from './variable-group.route.types';

export function registerPostImportVariableGroupRoute(app: ApiApp): void {
  app.post(
    compartmentVariableGroupImportPathname,
    createCurrentOrganizationRouteResponseOptions('variable.write', { 200: importVariableGroupResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      await reply.send(await executePostImportVariableGroupRequest(request)),
  );
}

async function executePostImportVariableGroupRequest(request: FastifyRequest): Promise<ImportVariableGroupResponse> {
  const body: ImportVariableGroupRequest = parseRequestValue(
    importVariableGroupBodySchema,
    request.body,
    'invalid_variable_group_body',
  );

  return importVariableGroupResponseSchema.parse(
    buildImportVariableGroupResponse(
      await importVariableGroupForPrincipal({
        entries: body.entries,
        organizationId: request.currentOrganization.id,
        principalId: request.actor.principalId,
        replace: body.replace,
        sensitivity: body.sensitivity,
        variableGroupName: body.variableGroupName,
      }),
    ),
  );
}
