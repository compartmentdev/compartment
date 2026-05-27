import type { FastifyReply, FastifyRequest } from 'fastify';
import { hasText } from '@compartment/utils';
import type { EdgeConfig } from '../../config';
import { readRequestHost } from '../../services/edge-gateway.service';
import {
  parseSafeForwardedRequestPath,
  type ParsedForwardedRequestPath,
} from '../../services/edge-forwarded-request-path.service';

const forwardedMethodHeaderName: string = 'x-forwarded-method';
const forwardedMethodValueSeparator: string = ',';
const forwardedUriHeaderName: string = 'x-forwarded-uri';

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
  return parseSafeForwardedRequestPath(readSingleForwardedHeader(request, forwardedUriHeaderName));
}

export function readForwardedRequestMethod(request: FastifyRequest): string | null {
  const forwardedMethod: string | null = readSingleForwardedHeader(request, forwardedMethodHeaderName);
  if (
    forwardedMethod === null ||
    !hasText(forwardedMethod) ||
    forwardedMethod.includes(forwardedMethodValueSeparator)
  ) {
    return null;
  }

  return forwardedMethod;
}

function readSingleForwardedHeader(request: FastifyRequest, headerName: string): string | null {
  const normalizedHeaderName: string = headerName.toLowerCase();
  const headerValue: string | string[] | undefined = request.headers[normalizedHeaderName];

  if (typeof headerValue !== 'string' || hasRepeatedRawHeader(request.raw.rawHeaders, normalizedHeaderName)) {
    return null;
  }

  return headerValue;
}

function hasRepeatedRawHeader(rawHeaders: string[], normalizedHeaderName: string): boolean {
  let matchingHeaderCount: number = 0;
  for (let index: number = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === normalizedHeaderName) {
      matchingHeaderCount += 1;
    }
    if (matchingHeaderCount > 1) {
      return true;
    }
  }

  return false;
}

export { readHeaderValue } from '@compartment/utils';
