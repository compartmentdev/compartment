import {
  buildFastifyResponseSchemas,
  activateStateQuerySchema,
  activateStateResponseSchema,
  type ActivateStateQuery,
  type ActivateStateResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { readActivationUnavailableReason } from '../../services/activation.service';
import { authenticateBrowserCompartmentSession } from '../../services/app-access.service';
import type { BrowserCompartmentSession } from '../../services/app-access.service.types';
import { requireInstalledCompartment } from '../../services/app-access-target.service';
import { readBrowserAuthTokenFlowToken } from '../../services/browser-auth-token-flow.service';
import { readBrowserActivateFlowCookie } from '../../services/browser-activate-flow-cookie.service';
import { readCompartmentSessionToken, readFlowTarget } from '../browser/browser-flow.helpers';
import type { BrowserFlowTargetOrNull } from '../browser/browser-flow.types';
import { buildActivateStateResponse } from './activate-state-response.helpers';
import { authApiActivateStatePathname } from './auth-api-paths';
import { authRateLimitRouteOptions } from './auth-rate-limit.route';

export function registerGetActivateStateRoute(app: ApiApp): void {
  app.get(
    authApiActivateStatePathname,
    {
      ...authRateLimitRouteOptions,
      schema: {
        response: buildFastifyResponseSchemas({
          200: activateStateResponseSchema,
        }),
      },
    },
    handleGetActivateState,
  );
}

async function handleGetActivateState(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const query: ActivateStateQuery = parseRequestValue(
    activateStateQuerySchema,
    request.query,
    'invalid_activate_state_query',
  );
  const session: BrowserCompartmentSession | null = await authenticateBrowserCompartmentSession(
    readCompartmentSessionToken(request),
  );
  const flowTarget: BrowserFlowTargetOrNull = readFlowTarget(query);
  const bootstrapToken: string | undefined = await readBrowserActivationToken(request.headers.cookie);
  const response: ActivateStateResponse = activateStateResponseSchema.parse(
    buildActivateStateResponse({
      email: query.email,
      flowTarget,
      hasToken: bootstrapToken !== undefined,
      principalEmail: session?.principalEmail,
      unavailableReason:
        bootstrapToken === undefined ? undefined : await readActivationUnavailableReason(bootstrapToken, query.email),
    }),
  );

  return await reply.send(response);
}

async function readBrowserActivationToken(cookieHeader: string | undefined): Promise<string | undefined> {
  return await readBrowserAuthTokenFlowToken('activation', readBrowserActivateFlowCookie(cookieHeader));
}
