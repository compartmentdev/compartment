import {
  appAccessLogoutRequestSchema,
  buildFastifyResponseSchemas,
  compartmentInternalAppAccessLogoutPathname,
  logoutResponseSchema,
  type AppAccessLogoutRequest,
  type LogoutResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { logoutAppAccessSession } from '../../services/app-access.service';

export function registerPostAppAccessLogoutRoute(app: ApiApp): void {
  app.post(
    compartmentInternalAppAccessLogoutPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: logoutResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: AppAccessLogoutRequest = parseRequestValue(
        appAccessLogoutRequestSchema,
        request.body,
        'invalid_app_access_logout_request',
      );
      await logoutAppAccessSession(input.appSessionToken);
      const response: LogoutResponse = logoutResponseSchema.parse({ success: true });

      return await reply.send(response);
    },
  );
}
