import { compartmentVariableBindingPathnameTemplate, variableGroupBindingResponseSchema } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { unbindVariableGroupForPrincipal } from '../../services/variable-groups.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { executeVariableGroupBindingRoute } from './variable-group-binding.route.helpers';

export function registerDeleteVariableBindingRoute(app: ApiApp): void {
  app.delete(
    compartmentVariableBindingPathnameTemplate,
    createCurrentOrganizationRouteResponseOptions('variable.write', { 200: variableGroupBindingResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      await reply.send(await executeVariableGroupBindingRoute(request, unbindVariableGroupForPrincipal)),
  );
}
