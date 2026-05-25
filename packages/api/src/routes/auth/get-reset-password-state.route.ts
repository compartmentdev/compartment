import {
  buildFastifyResponseSchemas,
  resetPasswordStateQuerySchema,
  resetPasswordStateResponseSchema,
  type ResetPasswordStateQuery,
  type ResetPasswordStateResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { authenticateBrowserCompartmentSession } from '../../services/app-access.service';
import type { BrowserCompartmentSession } from '../../services/app-access.service.types';
import { requireInstalledCompartment } from '../../services/app-access-target.service';
import { readBrowserAuthTokenFlowToken } from '../../services/browser-auth-token-flow.service';
import { readBrowserResetPasswordFlowCookie } from '../../services/browser-reset-password-flow-cookie.service';
import { readCompartmentSessionToken, readFlowTarget } from '../browser/browser-flow.helpers';
import type { BrowserFlowTargetOrNull } from '../browser/browser-flow.types';
import { authApiResetPasswordStatePathname } from './auth-api-paths';
import { authRateLimitRouteOptions } from './auth-rate-limit.route';
import { buildAuthTokenStateResponse } from './auth-token-state-response.helpers';

export function registerGetResetPasswordStateRoute(app: ApiApp): void {
  app.get(
    authApiResetPasswordStatePathname,
    {
      ...authRateLimitRouteOptions,
      schema: {
        response: buildFastifyResponseSchemas({
          200: resetPasswordStateResponseSchema,
        }),
      },
    },
    handleGetResetPasswordState,
  );
}

async function handleGetResetPasswordState(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const query: ResetPasswordStateQuery = parseRequestValue(
    resetPasswordStateQuerySchema,
    request.query,
    'invalid_reset_password_state_query',
  );
  const session: BrowserCompartmentSession | null = await authenticateBrowserCompartmentSession(
    readCompartmentSessionToken(request),
  );
  const flowTarget: BrowserFlowTargetOrNull = readFlowTarget(query);
  const resetToken: string | undefined = await readBrowserAuthTokenFlowToken(
    'password_reset',
    readBrowserResetPasswordFlowCookie(request.headers.cookie),
  );
  const response: ResetPasswordStateResponse = resetPasswordStateResponseSchema.parse(
    buildAuthTokenStateResponse({
      email: query.email,
      flowTarget,
      hasToken: resetToken !== undefined,
      principalEmail: session?.principalEmail,
    }),
  );

  return await reply.send(response);
}
