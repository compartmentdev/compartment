import {
  compartmentVariableImportPathname,
  importVariablesResponseSchema,
  type ImportVariablesResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { importVariablesForPrincipal } from '../../services/variables.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildImportVariablesResponse } from './variable.presenter';
import { variableImportRequestSchema, type ImportVariablesRequest } from './variable.route.types';

export function registerPostImportVariablesRoute(app: ApiApp): void {
  app.post(
    compartmentVariableImportPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: importVariablesResponseSchema }),
    handlePostImportVariablesRequest,
  );
}

async function handlePostImportVariablesRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: ImportVariablesRequest = parseRequestValue(
    variableImportRequestSchema,
    request.body,
    'invalid_variable_import_body',
  );
  const response: ImportVariablesResponse = await buildPostImportVariablesResponse(request, body);

  return await reply.send(response);
}

async function buildPostImportVariablesResponse(
  request: FastifyRequest,
  body: ImportVariablesRequest,
): Promise<ImportVariablesResponse> {
  return importVariablesResponseSchema.parse(
    buildImportVariablesResponse(
      await importVariablesForPrincipal({
        entries: body.entries,
        environmentName: body.environmentName,
        organizationSlug: request.currentOrganization.slug,
        principalId: request.actor.principalId,
        projectName: body.projectName,
        replace: body.replace,
        resourceName: body.resourceName,
        sensitivity: body.sensitivity,
        serviceName: body.serviceName,
      }),
    ),
  );
}
