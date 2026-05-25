import {
  buildFastifyResponseSchemas,
  loginDiscoveryRequestSchema,
  loginStateResponseSchema,
  type LoginDiscoveryRequest,
  type LoginStateResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { requireInstalledCompartment } from '../../services/app-access-target.service';
import { discoverBrowserLoginState } from '../../services/browser-login-flow.service';
import { readFlowTarget } from '../browser/browser-flow.helpers';
import type { BrowserFlowTargetOrNull } from '../browser/browser-flow.types';
import { authApiLoginDiscoveryPathname } from './auth-api-paths';
import { createAuthLoginDiscoveryRateLimitRouteOptions } from './auth-rate-limit.route';
import { buildLoginStateResponse } from './auth-state.presenter';

export function registerPostLoginDiscoveryRoute(app: ApiApp): void {
  app.post(
    authApiLoginDiscoveryPathname,
    {
      ...createAuthLoginDiscoveryRateLimitRouteOptions(app),
      schema: {
        response: buildFastifyResponseSchemas({
          200: loginStateResponseSchema,
        }),
      },
    },
    handlePostLoginDiscovery,
  );
}

async function handlePostLoginDiscovery(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const body: LoginDiscoveryRequest = parseRequestValue(
    loginDiscoveryRequestSchema,
    request.body,
    'invalid_login_discovery_request',
  );
  const flowTarget: BrowserFlowTargetOrNull = readFlowTarget(body);
  const allowAutoRedirect: boolean = body.autoRedirect ?? true;
  const response: LoginStateResponse = loginStateResponseSchema.parse(
    buildLoginStateResponse(
      await discoverBrowserLoginState(
        {
          email: body.email,
          flowTarget,
          organizationSlug: body.organizationSlug,
        },
        allowAutoRedirect,
      ),
      flowTarget,
      undefined,
    ),
  );

  return await reply.send(response);
}
