import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export const managedDomainRequestedLabelSourceMaxLength: number = 128;
export const managedDomainAllocationPathname: string = '/v1/managed-domains';

export interface ManagedDomainAllocationRequest {
  /** Stable idempotency key, also sent as Idempotency-Key. Brokers must return its existing allocation on retry. */
  installationId: string;
  metadata?: ManagedDomainAllocationMetadata | undefined;
  publicIp: string;
  requestedLabelSource: string;
}

export interface ManagedDomainAllocationMetadata {
  cliVersion: string;
  os: ManagedDomainAllocationOsMetadata;
  runtimeVersion: string;
}

export interface ManagedDomainAllocationOsMetadata {
  arch: string;
  platform: string;
  release: string;
}

export interface ManagedDomainAllocationResponse {
  acmeDnsToken: string;
  baseDomain: string;
}

export const managedDomainAllocationResponseSchema: ContractSchema<ManagedDomainAllocationResponse> = z
  .object({
    acmeDnsToken: z.string().min(1),
    baseDomain: z.string().min(1),
  })
  .strip();
