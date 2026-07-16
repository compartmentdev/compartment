import type { ManagedDomainAllocationResponse } from '@compartment/contracts';
import { allocateManagedDomain } from '@compartment/sdk';
import { createApiRequester } from './context.service';
import type { ManagedDomainAllocationInput } from './managed-domain.service.types';

const managedDomainBrokerRequestTimeoutMs: number = 10_000;

export async function allocateInstallManagedDomain(
  input: ManagedDomainAllocationInput,
): Promise<ManagedDomainAllocationResponse> {
  const { brokerUrl, ...request }: ManagedDomainAllocationInput = input;

  return await allocateManagedDomain(createApiRequester(brokerUrl, managedDomainBrokerRequestTimeoutMs), request);
}
