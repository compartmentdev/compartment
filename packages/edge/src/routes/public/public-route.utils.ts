import type { FastifyReply, FastifyRequest } from 'fastify';
import { readHeaderValue } from '@compartment/utils';
import type { EdgeConfig } from '../../config';
import { readRequestHost } from '../../services/edge-gateway.service';
import {
  parseSafeForwardedRequestPath,
  type ParsedForwardedRequestPath,
} from '../../services/edge-forwarded-request-path.service';

export function readPublicRequestHost(request: FastifyRequest): string | null {
  return readRequestHost(request.headers.host);
}

export function isControlPlaneRequestHost(host: string, config: EdgeConfig): boolean {
  return host === config.controlPlaneHost;
}

export async function replyRouteNotFound(reply: FastifyReply): Promise<FastifyReply> {
  return await reply.code(404).send({ error: 'route_not_found' });
}

export function setReplyCookies(reply: FastifyReply, cookies: string[]): void {
  if (cookies.length === 0) {
    return;
  }

  reply.header('Set-Cookie', cookies.length === 1 ? cookies[0] : cookies);
}

export function readForwardedRequestPath(request: FastifyRequest): ParsedForwardedRequestPath | null {
  const forwardedUri: string | string[] | undefined = request.headers['x-forwarded-uri'];
  const candidate: string | undefined = readHeaderValue(forwardedUri);

  return parseSafeForwardedRequestPath(candidate);
}

export function readForwardedRequestMethod(request: FastifyRequest): string {
  const forwardedMethod: string | string[] | undefined = request.headers['x-forwarded-method'];
  const candidate: string | undefined = readHeaderValue(forwardedMethod);

  return candidate ?? request.method;
}

export { readHeaderValue };
