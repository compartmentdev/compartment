import {
  buildFastifyResponseSchemas,
  compartmentOrganizationListPathname,
  organizationListResponseSchema,
  type OrganizationListResponse,
  type OrganizationSummary,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { listSessionVisibleOrganizations } from '../../services/organizations.service';
import { buildOrganizationSummaries } from '../presenters/organization.presenter';

export function registerGetOrganizationsRoute(app: ApiApp): void {
  app.get(
    compartmentOrganizationListPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: organizationListResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const organizations: OrganizationSummary[] = buildOrganizationSummaries(
        await listSessionVisibleOrganizations(request.actor.authSession),
      );
      const response: OrganizationListResponse = organizationListResponseSchema.parse({
        organizations,
      });

      return await reply.send(response);
    },
  );
}
