import { buildFastifyResponseSchemas, logoutResponseSchema, type LogoutResponse } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { createClearedCompartmentSessionCookie } from '../../services/browser-session-cookie.service';
import { logout } from '../../services/logout.service';
import { authApiLogoutPathname } from './auth-api-paths';

export function registerPostLogoutRoute(app: ApiApp): void {
  app.post(
    authApiLogoutPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: logoutResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      await logout(request.actor);
      if (request.authTransport === 'browser_cookie') {
        reply.header('Set-Cookie', createClearedCompartmentSessionCookie());
      }
      const response: LogoutResponse = logoutResponseSchema.parse({ success: true });

      return await reply.send(response);
    },
  );
}
