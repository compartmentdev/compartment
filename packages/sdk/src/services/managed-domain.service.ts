import {
  managedDomainAllocationPathname,
  managedDomainAllocationResponseSchema,
  type ManagedDomainAllocationRequest,
  type ManagedDomainAllocationResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function allocateManagedDomain(
  request: CompartmentRequester,
  body: ManagedDomainAllocationRequest,
): Promise<ManagedDomainAllocationResponse> {
  return await request<ManagedDomainAllocationResponse, ManagedDomainAllocationRequest>({
    body,
    idempotencyKey: body.installationId,
    method: 'POST',
    path: managedDomainAllocationPathname,
    schema: managedDomainAllocationResponseSchema,
  });
}
