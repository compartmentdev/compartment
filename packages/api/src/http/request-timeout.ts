import type { FastifyRequest } from 'fastify';

export const defaultRequestReceiveTimeoutMs: number = 5 * 60 * 1000;
export const sourceArchiveRequestTimeoutMs: number = 15 * 60 * 1000;

export function applyTransportRequestTimeout(request: FastifyRequest, timeoutMs: number): void {
  const setTimeout: RequestTimeoutSetter | undefined = resolveRawRequestTimeoutSetter(request);
  if (setTimeout === undefined) {
    return;
  }

  setTimeout(timeoutMs);
}

function resolveRawRequestTimeoutSetter(request: FastifyRequest): RequestTimeoutSetter | undefined {
  // This only overrides the raw socket inactivity timeout for a real request object.
  // It does not change the server-wide total request receive timeout.
  // Fastify inject requests are not backed by a real Node socket, so there is no raw request timeout to override.
  return typeof request.raw.setTimeout === 'function' ? request.raw.setTimeout.bind(request.raw) : undefined;
}

type RequestTimeoutSetter = (timeoutMs: number) => void;
