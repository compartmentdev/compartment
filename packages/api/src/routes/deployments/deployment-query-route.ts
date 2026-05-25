import type { FastifyReply, FastifyRequest } from 'fastify';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildStatusLookupInput } from './deployment-query-route.helpers';
import type { DeploymentQueryRouteQuery, RegisterDeploymentQueryRouteInput } from './deployment-query-route.types';

export function registerDeploymentQueryRoute<TQuery extends DeploymentQueryRouteQuery, TSummary, TResponse>(
  input: RegisterDeploymentQueryRouteInput<TQuery, TSummary, TResponse>,
): void {
  input.app.get(
    input.path,
    createCurrentOrganizationRouteResponseOptions(input.currentOrganizationPermission, { 200: input.responseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const query: TQuery = parseRequestValue(input.querySchema, request.query, input.invalidQueryErrorCode);
      const summary: TSummary = await input.loadSummary(
        buildStatusLookupInput(query, {
          organizationSlug: request.currentOrganization.slug,
          principalId: request.actor.principalId,
        }),
      );
      const response: TResponse = input.responseSchema.parse(await input.buildResponse(summary, request));

      return await reply.send(response);
    },
  );
}
