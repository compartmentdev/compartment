import {
  buildFastifyResponseSchemas,
  cliLoginStartRequestSchema,
  cliLoginStartResponseSchema,
  type CliLoginStartRequest,
  type CliLoginStartResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { requireInstalledCompartment } from '../../services/app-access-target.service';
import { startCliLogin } from '../../services/cli-login.service';
import type { CliLoginStartResult } from '../../services/cli-login.service.types';
import { authApiCliStartPathname } from './auth-api-paths';
import { createAuthLoginRateLimitRouteOptions } from './auth-rate-limit.route';
import { buildCliLoginStartResponse } from './auth-cli.presenter';

export function registerPostCliStartRoute(app: ApiApp): void {
  app.post(
    authApiCliStartPathname,
    {
      ...createAuthLoginRateLimitRouteOptions(),
      schema: {
        response: buildFastifyResponseSchemas({
          200: cliLoginStartResponseSchema,
        }),
      },
    },
    handlePostCliStart,
  );
}

async function handlePostCliStart(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const body: CliLoginStartRequest = parseRequestValue(
    cliLoginStartRequestSchema,
    request.body,
    'invalid_cli_login_start_request',
  );
  const result: CliLoginStartResult = await startCliLogin(body);
  const response: CliLoginStartResponse = cliLoginStartResponseSchema.parse(buildCliLoginStartResponse(result));

  return await reply.send(response);
}
