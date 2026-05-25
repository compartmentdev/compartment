import {
  compartmentVariableLocalRunPathname,
  variableLocalRunResponseSchema,
  type VariableLocalRunResponse,
} from '@compartment/contracts';
import type { FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { loadVariablesForLocalRun } from '../../services/variables.local-run.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildVariableLocalRunResponse } from './variable.presenter';
import { variableLocalRunBodySchema, type VariableLocalRunRequest } from './variable.route.types';

export function registerPostVariableLocalRunRoute(app: ApiApp): void {
  app.post(
    compartmentVariableLocalRunPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: variableLocalRunResponseSchema }),
    handlePostVariableLocalRun,
  );
}

async function handlePostVariableLocalRun(request: FastifyRequest): Promise<VariableLocalRunResponse> {
  const body: VariableLocalRunRequest = parseRequestValue(
    variableLocalRunBodySchema,
    request.body,
    'invalid_variable_local_run_body',
  );

  return variableLocalRunResponseSchema.parse(
    buildVariableLocalRunResponse(
      await loadVariablesForLocalRun({
        commandName: body.commandName,
        environmentName: body.environmentName,
        organizationSlug: request.currentOrganization.slug,
        principalId: request.actor.principalId,
        projectName: body.projectName,
        resourceName: body.resourceName ?? null,
        serviceName: body.serviceName,
      }),
    ),
  );
}
