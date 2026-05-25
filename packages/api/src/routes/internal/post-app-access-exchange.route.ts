import {
  appAccessExchangeRequestSchema,
  appAccessExchangeResponseSchema,
  buildFastifyResponseSchemas,
  compartmentInternalAppAccessExchangePathname,
  type FastifyResponseSchemas,
  type AppAccessExchangeRequest,
  type AppAccessExchangeResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { buildAppAccessExchangeResponse } from './app-access.presenter';
import { exchangeAppAccessCode } from '../../services/app-access.service';

interface AppAccessExchangeRouteOptions {
  schema: {
    response: FastifyResponseSchemas;
  };
}

export function registerPostAppAccessExchangeRoute(app: ApiApp): void {
  app.post(compartmentInternalAppAccessExchangePathname, appAccessExchangeRouteOptions, handlePostAppAccessExchange);
}

const appAccessExchangeRouteOptions: AppAccessExchangeRouteOptions = {
  schema: {
    response: buildFastifyResponseSchemas({
      200: appAccessExchangeResponseSchema,
    }),
  },
};

async function handlePostAppAccessExchange(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const requestBody: AppAccessExchangeRequest = parseRequestValue(
    appAccessExchangeRequestSchema,
    request.body,
    'invalid_app_access_exchange_request',
  );
  const response: AppAccessExchangeResponse = appAccessExchangeResponseSchema.parse(
    buildAppAccessExchangeResponse(
      await exchangeAppAccessCode({
        code: requestBody.code,
        host: requestBody.host,
        state: requestBody.state,
      }),
    ),
  );

  return await reply.send(response);
}
