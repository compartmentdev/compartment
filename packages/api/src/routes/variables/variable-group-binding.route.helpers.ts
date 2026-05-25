import { type VariableGroupBindingResponse, variableGroupBindingResponseSchema } from '@compartment/contracts';
import type { FastifyRequest } from 'fastify';
import { parseRequestValue } from '../../http/validation';
import type {
  VariableGroupBindingInput,
  VariableGroupBindingResult,
} from '../../services/variable-groups.service.types';
import { buildVariableGroupBindingResponse } from './variable-group.presenter';
import { variableGroupRouteParamsSchema, type VariableGroupRouteParams } from './variable-group.route.types';
import { variableQuerySchema, type VariableTargetQuery } from './variable.route.types';

type VariableGroupBindingMutation = (input: VariableGroupBindingInput) => Promise<VariableGroupBindingResult>;

export async function executeVariableGroupBindingRoute(
  request: FastifyRequest,
  mutation: VariableGroupBindingMutation,
): Promise<VariableGroupBindingResponse> {
  const params: VariableGroupRouteParams = parseRequestValue(
    variableGroupRouteParamsSchema,
    request.params,
    'invalid_variable_group_params',
  );
  const query: VariableTargetQuery = parseRequestValue(variableQuerySchema, request.query, 'invalid_variable_query');

  return variableGroupBindingResponseSchema.parse(
    buildVariableGroupBindingResponse(
      await mutation({
        environmentName: query.environmentName,
        organizationId: request.currentOrganization.id,
        organizationSlug: request.currentOrganization.slug,
        principalId: request.actor.principalId,
        projectName: query.projectName,
        resourceName: query.resourceName,
        serviceName: query.serviceName,
        variableGroupName: params.variableGroupName,
      }),
    ),
  );
}
