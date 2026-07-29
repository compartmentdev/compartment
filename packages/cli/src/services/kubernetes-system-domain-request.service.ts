import { createHash } from 'node:crypto';
import {
  systemDomainMutationResponseSchema,
  systemDomainStatusResponseSchema,
  type SystemDomainMutationResponse,
  type SystemDomainSetRequest,
  type SystemDomainStatusResponse,
  type SystemDomainVersionedRequest,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';

type SystemDomainRequest = SystemDomainSetRequest | SystemDomainVersionedRequest;

export function buildSystemDomainIdempotencyKey(path: string, version: number, body: SystemDomainRequest): string {
  const hash: string = createHash('sha256').update(JSON.stringify({ body, path, version })).digest('hex').slice(0, 24);
  return `domain-${version.toString()}-${hash}`;
}

export function parseSystemDomainStatus(value: JsonValue | null): SystemDomainStatusResponse {
  return systemDomainStatusResponseSchema.parse(value);
}

export function parseSystemDomainMutation(value: JsonValue | null): SystemDomainMutationResponse {
  return systemDomainMutationResponseSchema.parse(value);
}
