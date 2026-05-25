import { readHeaderValue } from '@compartment/utils';
import type { HookHandlerDoneFunction, FastifyReply, FastifyRequest } from 'fastify';
import { requireExpectedBearerToken } from '../../http/headers';
import { getApiConfig } from '../../runtime/runtime-access';

const internalEdgeUnauthorizedCode: string = 'internal_edge_unauthorized';
const internalEdgeUnauthorizedMessage: string = 'A valid internal edge token is required.';

export function authenticateInternalEdgeRequest(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  requireExpectedBearerToken(
    readHeaderValue(request.headers.authorization),
    getApiConfig().edgeToken,
    internalEdgeUnauthorizedCode,
    internalEdgeUnauthorizedMessage,
  );
  done();
}
