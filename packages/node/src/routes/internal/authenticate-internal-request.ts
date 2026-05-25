import { readBearerToken } from '@compartment/utils';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { NodeConfig } from '../../config';
import type { AuthenticateNodeInternalRequest, NodeInternalUnauthorizedResponse } from './internal-routes.types';

const runtimeControlUnauthorizedCode: string = 'internal_worker_unauthorized';
const runtimeControlUnauthorizedMessage: string = 'A valid runtime control token is required.';

const internalUnauthorizedResponse: NodeInternalUnauthorizedResponse = {
  error: runtimeControlUnauthorizedCode,
  message: runtimeControlUnauthorizedMessage,
};

export function createAuthenticateInternalRequest(config: NodeConfig): AuthenticateNodeInternalRequest {
  return async function authenticateInternalRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (readBearerToken(request.headers.authorization) === config.runtimeControlToken) {
      return;
    }

    await reply.code(401).send(internalUnauthorizedResponse);
  };
}
