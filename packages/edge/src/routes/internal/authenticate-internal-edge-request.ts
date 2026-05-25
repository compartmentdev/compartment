import { readBearerToken } from '@compartment/utils';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getEdgeConfig } from '../../runtime/runtime-access';

export async function authenticateInternalEdgeRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (readBearerToken(request.headers.authorization) === getEdgeConfig().edgeToken) {
    return;
  }

  await reply.code(401).send({ error: 'unauthorized' });
}
