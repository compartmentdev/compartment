import { compartmentVariableBindingPathnameTemplate, variableGroupBindingResponseSchema } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { bindVariableGroupForPrincipal } from '../../services/variable-groups.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { executeVariableGroupBindingRoute } from './variable-group-binding.route.helpers';

export function registerPostVariableBindingRoute(app: ApiApp): void {
  app.post(
    compartmentVariableBindingPathnameTemplate,
    createCurrentOrganizationRouteResponseOptions('variable.write', { 200: variableGroupBindingResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      await reply.send(await executeVariableGroupBindingRoute(request, bindVariableGroupForPrincipal)),
  );
}
