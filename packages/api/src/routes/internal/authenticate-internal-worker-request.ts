import { readHeaderValue } from '@compartment/utils';
import type { HookHandlerDoneFunction, FastifyReply, FastifyRequest } from 'fastify';
import { requireExpectedBearerToken } from '../../http/headers';
import { getApiConfig } from '../../runtime/runtime-access';

const runtimeControlUnauthorizedCode: string = 'internal_worker_unauthorized';
const runtimeControlUnauthorizedMessage: string = 'A valid runtime control token is required.';

export function authenticateInternalWorkerRequest(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  requireExpectedBearerToken(
    readHeaderValue(request.headers.authorization),
    getApiConfig().runtimeControlToken,
    runtimeControlUnauthorizedCode,
    runtimeControlUnauthorizedMessage,
  );
  done();
}
