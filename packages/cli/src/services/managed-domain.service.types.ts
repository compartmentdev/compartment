import type { ManagedDomainAllocationRequest } from '@compartment/contracts';

export interface ManagedDomainAllocationInput extends ManagedDomainAllocationRequest {
  brokerUrl: string;
}
