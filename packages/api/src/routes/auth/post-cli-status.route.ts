import {
  buildFastifyResponseSchemas,
  cliLoginStatusRequestSchema,
  cliLoginStatusResponseSchema,
  type CliLoginStatusRequest,
  type CliLoginStatusResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { requireInstalledCompartment } from '../../services/app-access-target.service';
import { getCliLoginStatus } from '../../services/cli-login.service';
import type { CliLoginStatusResult } from '../../services/cli-login.service.types';
import { authApiCliStatusPathname } from './auth-api-paths';
import { authCliLoginRateLimitRouteOptions } from './auth-rate-limit.route';
import { buildCliLoginStatusResponse } from './auth-cli.presenter';

export function registerPostCliStatusRoute(app: ApiApp): void {
  app.post(
    authApiCliStatusPathname,
    {
      ...authCliLoginRateLimitRouteOptions,
      schema: {
        response: buildFastifyResponseSchemas({
          200: cliLoginStatusResponseSchema,
        }),
      },
    },
    handlePostCliStatus,
  );
}

async function handlePostCliStatus(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const body: CliLoginStatusRequest = parseRequestValue(
    cliLoginStatusRequestSchema,
    request.body,
    'invalid_cli_login_status_request',
  );
  const result: CliLoginStatusResult = await getCliLoginStatus(body);
  const response: CliLoginStatusResponse = cliLoginStatusResponseSchema.parse(buildCliLoginStatusResponse(result));

  return await reply.send(response);
}
