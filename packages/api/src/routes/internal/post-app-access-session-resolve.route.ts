import {
  appAccessSessionResolveRequestSchema,
  appAccessSessionResolveResponseSchema,
  buildFastifyResponseSchemas,
  compartmentInternalAppAccessSessionResolvePathname,
  type AppAccessSessionResolveRequest,
  type AppAccessSessionResolveResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { resolveAppAccessSession } from '../../services/app-access-session-resolution.service';

export function registerPostAppAccessSessionResolveRoute(app: ApiApp): void {
  app.post(
    compartmentInternalAppAccessSessionResolvePathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: appAccessSessionResolveResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: AppAccessSessionResolveRequest = parseRequestValue(
        appAccessSessionResolveRequestSchema,
        request.body,
        'invalid_app_access_session_resolve_request',
      );
      const response: AppAccessSessionResolveResponse = appAccessSessionResolveResponseSchema.parse({
        session: await resolveAppAccessSession(input.appSessionToken),
      });
      return await reply.send(response);
    },
  );
}
