import type { DoneFuncWithErrOrRes, FastifyReply, FastifyRequest } from 'fastify';

type NoStoreResponsePayload = string | Buffer | NodeJS.ReadableStream | null;

const noStoreCacheControlHeaderValue: string = 'no-store';

export function addNoStoreCacheControlHeader(
  _request: FastifyRequest,
  reply: FastifyReply,
  payload: NoStoreResponsePayload,
  done: DoneFuncWithErrOrRes,
): void {
  reply.header('Cache-Control', noStoreCacheControlHeaderValue);

  done(null, payload);
}
