import {
  appAccessStateResponseSchema,
  buildFastifyResponseSchemas,
  compartmentInternalAppAccessStatePathname,
  type AppAccessStateResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { buildAppAccessStateResponse } from '../../lib/app-access-state-response';
import { readAppAccessState } from '../../services/app-access-state.service';

export function registerGetAppAccessStateRoute(app: ApiApp): void {
  app.get(
    compartmentInternalAppAccessStatePathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: appAccessStateResponseSchema,
        }),
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const response: AppAccessStateResponse = buildAppAccessStateResponse(await readAppAccessState());

      return await reply.send(response);
    },
  );
}
