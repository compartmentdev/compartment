import type { ManagedDomainAllocationRequest } from '@compartment/contracts';

export interface ManagedDomainAllocationInput extends ManagedDomainAllocationRequest {
  brokerUrl: string;
}

export interface ManagedDomainRequestFailure extends Error {
  method: string;
  requestId?: string | undefined;
  statusCode: number;
  url: string;
}
