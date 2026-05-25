import {
  compartmentInternalAppAccessSessionsRevokePathname,
  edgeInvalidateAppSessionsRequestSchema,
  type EdgeInvalidateAppSessionsRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EdgeApp } from '../../app.types';
import type { EdgeAppAccessStateStore } from '../../services/app-access-state-store.service.types';

export function registerPostInvalidateAppSessionsRoute(app: EdgeApp, store: EdgeAppAccessStateStore): void {
  app.post(
    compartmentInternalAppAccessSessionsRevokePathname,
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: EdgeInvalidateAppSessionsRequest = edgeInvalidateAppSessionsRequestSchema.parse(request.body);
      store.revokeAuthSession(input.authSessionId);

      return await reply.code(204).send();
    },
  );
}
