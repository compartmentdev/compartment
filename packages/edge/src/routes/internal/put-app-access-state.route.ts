import {
  appAccessStateResponseSchema,
  compartmentInternalAppAccessStatePathname,
  type AppAccessStateResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EdgeApp } from '../../app.types';
import type { EdgeAppAccessStateStore } from '../../services/app-access-state-store.service.types';

export function registerPutAppAccessStateRoute(app: EdgeApp, store: EdgeAppAccessStateStore): void {
  app.put(
    compartmentInternalAppAccessStatePathname,
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: AppAccessStateResponse = appAccessStateResponseSchema.parse(request.body);
      if (input.state === null) {
        store.clearSnapshot();
      } else {
        store.replaceSnapshot(input.state);
      }

      return await reply.code(204).send();
    },
  );
}
