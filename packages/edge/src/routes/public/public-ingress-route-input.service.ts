import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EdgeConfig } from '../../config';
import type { ParsedForwardedRequestPath } from '../../services/edge-forwarded-request-path.service';
import type { LocalEdgeRouteInput } from '../../services/edge-route-resolution.service.types';
import { readAppHostOrReply } from './public-route-host.service';
import { readForwardedRequestMethod, readForwardedRequestPath, replyRouteNotFound } from './public-route.utils';

export async function readLocalEdgeRouteInputOrReply(
  request: FastifyRequest,
  reply: FastifyReply,
  config: EdgeConfig,
): Promise<LocalEdgeRouteInput | null> {
  const host: string | null = await readAppHostOrReply(request, reply, config);
  if (host === null) {
    return null;
  }
  const path: ParsedForwardedRequestPath | null = readForwardedRequestPath(request);
  const method: string | null = readForwardedRequestMethod(request);
  if (path === null || method === null) {
    await replyRouteNotFound(reply);
    return null;
  }

  return { host, method, path };
}
