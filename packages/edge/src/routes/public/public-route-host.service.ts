import type { FastifyReply, FastifyRequest } from 'fastify';
import { hasText, readHeaderValue } from '@compartment/utils';
import type { EdgeConfig } from '../../config';
import { isControlPlaneRequestHost, readPublicRequestHost, replyRouteNotFound } from './public-route.utils';

export async function readAppHostOrReply(
  request: FastifyRequest,
  reply: FastifyReply,
  config: EdgeConfig,
): Promise<string | null> {
  const host: string | null = await readPublicHostOrReply(request, reply);
  if (host === null) {
    return null;
  }
  if (isControlPlaneRequestHost(host, config)) {
    await replyRouteNotFound(reply);
    return null;
  }

  return host;
}

async function readPublicHostOrReply(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const host: string | null = readPublicRequestHost(request);
  if (host !== null) {
    return host;
  }
  if (hasText(readHeaderValue(request.headers.host))) {
    await reply.code(400).send({ error: 'invalid_host_header' });
    return null;
  }

  await replyRouteNotFound(reply);

  return null;
}
