import { readHeaderValue } from '@compartment/utils';
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import { requireExpectedBearerToken } from '../../http/headers';
import { getApiConfig } from '../../runtime/runtime-access';
import { deriveProductLogIngestToken } from './product-log-ingest-token';

export function authenticateProductLogIngestRequest(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  requireExpectedBearerToken(
    readHeaderValue(request.headers.authorization),
    deriveProductLogIngestToken(getApiConfig().runtimeControlToken),
    'product_log_ingest_unauthorized',
    'A valid product log ingest token is required.',
  );
  done();
}
