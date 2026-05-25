import { readHeaderValue } from '@compartment/utils';
import type { HookHandlerDoneFunction, FastifyReply, FastifyRequest } from 'fastify';
import { requireExpectedBearerToken } from '../../http/headers';
import { getApiConfig } from '../../runtime/runtime-access';

const systemUnauthorizedCode: string = 'system_api_unauthorized';
const systemUnauthorizedMessage: string = 'A valid system API token is required.';

export function authenticateSystemRequest(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  requireExpectedBearerToken(
    readHeaderValue(request.headers.authorization),
    getApiConfig().systemToken,
    systemUnauthorizedCode,
    systemUnauthorizedMessage,
  );
  done();
}
