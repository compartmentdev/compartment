import type { DoneFuncWithErrOrRes, FastifyReply, FastifyRequest } from 'fastify';
import {
  browserAntiFramingContentSecurityPolicy,
  browserAntiFramingFrameOptions,
} from './browser-anti-framing.headers';

type BrowserOnSendPayload = string | Buffer | NodeJS.ReadableStream | null;

export function addBrowserAntiFramingHeaders(
  _request: FastifyRequest,
  reply: FastifyReply,
  payload: BrowserOnSendPayload,
  done: DoneFuncWithErrOrRes,
): void {
  reply.header('Content-Security-Policy', browserAntiFramingContentSecurityPolicy);
  reply.header('X-Frame-Options', browserAntiFramingFrameOptions);

  done(null, payload);
}
