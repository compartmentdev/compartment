import { readHeaderValue } from '@compartment/utils';
import type { FastifyRequest } from 'fastify';
import { ApiBoundaryError } from '../../errors/api-boundary-error';

const idempotencyKeyHeaderName: string = 'idempotency-key';

export function readRequiredIdempotencyKey(request: FastifyRequest): string {
  const idempotencyKey: string | undefined = readHeaderValue(request.headers[idempotencyKeyHeaderName]);
  if (idempotencyKey === undefined || idempotencyKey.trim() === '') {
    throw new ApiBoundaryError(400, 'missing_idempotency_key', 'An Idempotency-Key header is required.');
  }

  return idempotencyKey;
}
