import {
  buildFastifyResponseSchemas,
  cliLoginExchangeRequestSchema,
  cliLoginExchangeResponseSchema,
  type CliLoginExchangeRequest,
  type CliLoginExchangeResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { requireInstalledCompartment } from '../../services/app-access-target.service';
import { exchangeCliLogin } from '../../services/cli-login.service';
import type { CliLoginExchangeResult } from '../../services/cli-login.service.types';
import { authApiCliExchangePathname } from './auth-api-paths';
import { authCliLoginRateLimitRouteOptions } from './auth-rate-limit.route';
import { buildCliLoginExchangeResponse } from './auth-cli.presenter';

export function registerPostCliExchangeRoute(app: ApiApp): void {
  app.post(
    authApiCliExchangePathname,
    {
      ...authCliLoginRateLimitRouteOptions,
      schema: {
        response: buildFastifyResponseSchemas({
          200: cliLoginExchangeResponseSchema,
        }),
      },
    },
    handlePostCliExchange,
  );
}

async function handlePostCliExchange(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const body: CliLoginExchangeRequest = parseRequestValue(
    cliLoginExchangeRequestSchema,
    request.body,
    'invalid_cli_login_exchange_request',
  );
  const result: CliLoginExchangeResult = await exchangeCliLogin(body);
  const response: CliLoginExchangeResponse = cliLoginExchangeResponseSchema.parse(
    buildCliLoginExchangeResponse(result),
  );

  return await reply.send(response);
}
